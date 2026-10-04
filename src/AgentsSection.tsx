import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowClockwise, Cube, DownloadSimple } from '@phosphor-icons/react';
import { download } from './lib';
import { AGENTS, AGENT_KINDS, AGENT_INTERVAL_MS, agentReportMarkdown, appendAgentReport, executeAgent, lastSuccessfulReport, loadAgentHistory, saveAgentHistory, unavailableReport } from './agent-tools';
import type { AgentKind, AgentReport } from './agent-tools';

type Attempt = { busy: boolean; error: string; reports: number };
function emptyAttempts(history: AgentReport[] = []): Record<AgentKind, Attempt> {
  const result: Record<AgentKind, Attempt> = { 'market-watch': { busy: false, error: '', reports: 0 }, 'publication-watch': { busy: false, error: '', reports: 0 }, 'network-brief': { busy: false, error: '', reports: 0 } };
  for (const report of history) result[report.kind].error = report.status === 'unavailable' ? report.error : '';
  return result;
}
function deviceStorage(): Storage | null { try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; } }
function utc(value: string): string { return value.replace('T', ' ').replace('Z', ' UTC'); }

export default function AgentsSection() {
  const [initial] = useState(() => loadAgentHistory(deviceStorage()));
  const [history, setHistory] = useState(initial.reports);
  const [storageIssue, setStorageIssue] = useState(initial.issue);
  const [attempts, setAttempts] = useState(() => emptyAttempts(initial.reports));
  const [watching, setWatching] = useState(false);
  const [visible, setVisible] = useState(() => typeof document !== 'undefined' && !document.hidden);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const currentHistory = useRef(initial.reports), controllers = useRef<Partial<Record<AgentKind, AbortController>>>({}), mounted = useRef(true);

  const acceptReport = useCallback((report: AgentReport) => {
    const next = appendAgentReport(currentHistory.current, report);
    currentHistory.current = next; setHistory(next); setSelectedId(report.id);
    setStorageIssue(saveAgentHistory(deviceStorage(), next) ? null : 'Device storage could not save this report. It remains available in this session and can be downloaded.');
  }, []);
  const runAgent = useCallback(async (kind: AgentKind) => {
    if (!mounted.current || document.hidden || controllers.current[kind]) return;
    const controller = new AbortController(); controllers.current[kind] = controller;
    setAttempts(old => ({ ...old, [kind]: { ...old[kind], busy: true, error: '' } }));
    try {
      const report = await executeAgent(kind, lastSuccessfulReport(currentHistory.current, kind), controller.signal);
      if (!mounted.current || controller.signal.aborted || controllers.current[kind] !== controller) return;
      acceptReport(report);
      setAttempts(old => ({ ...old, [kind]: { ...old[kind], reports: old[kind].reports + 1 } }));
    } catch (reason) {
      if (!mounted.current || controller.signal.aborted || controllers.current[kind] !== controller) return;
      const report = unavailableReport(kind, reason); acceptReport(report);
      setAttempts(old => ({ ...old, [kind]: { ...old[kind], error: report.status === 'unavailable' ? report.error : 'The source is unavailable.' } }));
    } finally {
      if (controllers.current[kind] === controller) {
        delete controllers.current[kind];
        if (mounted.current) setAttempts(old => ({ ...old, [kind]: { ...old[kind], busy: false } }));
      }
    }
  }, [acceptReport]);
  const runAll = useCallback(() => Promise.allSettled(AGENT_KINDS.map(runAgent)), [runAgent]);
  const cancelChecks = useCallback(() => {
    for (const controller of Object.values(controllers.current)) controller?.abort();
    controllers.current = {};
    if (mounted.current) setAttempts(old => Object.fromEntries(AGENT_KINDS.map(kind => [kind, { ...old[kind], busy: false }])) as Record<AgentKind, Attempt>);
  }, []);

  useEffect(() => {
    mounted.current = true;
    const onVisibility = () => { setVisible(!document.hidden); if (document.hidden) cancelChecks(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { mounted.current = false; document.removeEventListener('visibilitychange', onVisibility); for (const controller of Object.values(controllers.current)) controller?.abort(); controllers.current = {}; };
  }, [cancelChecks]);
  useEffect(() => {
    if (!watching) return;
    const interval = window.setInterval(() => { if (!document.hidden) void runAll(); }, AGENT_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [watching, runAll]);

  const busy = AGENT_KINDS.some(kind => attempts[kind].busy);
  const selected = history.find(report => report.id === selectedId) ?? null;
  const saveMarkdown = (report: AgentReport) => download(`VOXEN-IMD-${report.kind}-${report.executedAt.slice(0, 19).replace(/:/g, '-')}.md`, agentReportMarkdown(report), 'text/markdown;charset=utf-8');
  const saveJSON = (report: AgentReport) => download(`VOXEN-IMD-${report.kind}-${report.executedAt.slice(0, 19).replace(/:/g, '-')}.json`, JSON.stringify(report, null, 2), 'application/json');

  return <section id="agents" className="district agent-section" aria-labelledby="agent-title">
    <div className="agent-heading"><div className="section-icon"><Cube weight="fill" /></div><div><p className="eyebrow agent-eyebrow">YOUR AUTOMATED READINGS</p><h2 id="agent-title">Agent workspace</h2><p className="agent-intro">Three rule-based agents read public sources, compare recorded results and create reports. Their analysis uses defined rules.</p></div></div>
    <div className="agent-controls"><button className="btn violet" disabled={busy || !visible} onClick={() => void runAll()}>Run all <ArrowClockwise /></button><button className="btn dark" disabled={!visible && !watching} onClick={() => { if (watching) { setWatching(false); cancelChecks(); } else { setWatching(true); void runAll(); } }}>{watching ? 'Stop checks' : 'Start watching'}</button><span className="agent-watch-status" role="status">{watching ? visible ? 'Watching every 60 seconds while this page is visible.' : 'Watching paused while this page is hidden.' : 'Scheduled checks are stopped.'}</span></div>
    <p className="fine-print">Reports stay on this device. Closing the page stops scheduled checks. A source reading may be cached; its acquisition time is preserved.</p>
    {storageIssue && <p className="agent-storage-notice" role="status">{storageIssue}</p>}
    <div className="agent-grid">{AGENT_KINDS.map(kind => {
      const agent = AGENTS[kind], attempt = attempts[kind], previous = lastSuccessfulReport(history, kind);
      const status = attempt.busy ? 'Running' : attempt.error ? 'Source unavailable' : previous?.status === 'partial' ? 'Partial reading' : previous ? 'Reading accepted' : 'Awaiting a run';
      return <article className="agent-card" key={kind}><div className="agent-card-top"><h3>{agent.title}</h3><span className={`agent-status ${attempt.busy ? 'running' : attempt.error ? 'error' : previous?.status ?? 'idle'}`}>{status}</span></div><p>{agent.description}</p><div className="agent-card-actions"><button className="text-btn" disabled={attempt.busy || !visible} onClick={() => void runAgent(kind)}>{attempt.busy ? 'Reading source…' : 'Run now'} <ArrowClockwise /></button>{previous && <button className="text-btn" onClick={() => setSelectedId(previous.id)}>Last accepted report</button>}</div>{attempt.error && <p className="agent-error" role="alert">{attempt.error} {previous ? 'The last accepted report is retained below.' : 'No accepted report is available yet.'}</p>}<div className="agent-reading"><span>Reports accepted this session: {attempt.reports}</span>{previous && <><span>Last accepted execution: {utc(previous.executedAt)}</span><span>Source acquired at: {utc(previous.readingAt!)}</span></>}</div></article>;
    })}</div>
    <div className="agent-history"><div className="agent-history-heading"><h3>Report history</h3><span>Up to 10 reports kept on this device</span>{history.length > 0 && <button className="text-btn" onClick={() => download('VOXEN-IMD-agent-history.json', JSON.stringify({ version: 1, reports: history }, null, 2), 'application/json')}>Export history <DownloadSimple /></button>}</div>{history.length === 0 ? <p>Run an agent to create a report from its actual source response.</p> : <ol>{[...history].reverse().map(report => <li className="agent-history-item" key={report.id}><button type="button" aria-pressed={selected?.id === report.id} onClick={() => setSelectedId(report.id)}><strong>{AGENTS[report.kind].title}</strong><time dateTime={report.executedAt}>{utc(report.executedAt)}</time><span>{report.status === 'unavailable' ? 'Source unavailable' : report.status === 'partial' ? 'Partial reading' : 'Reading accepted'}</span></button></li>)}</ol>}</div>
    {selected && <div className="agent-report-view" aria-live="polite"><div className="agent-report-meta"><h3>{AGENTS[selected.kind].title} report</h3><span>{utc(selected.executedAt)}</span></div><div className="agent-report-actions"><button className="text-btn" onClick={() => saveMarkdown(selected)}>Save report <DownloadSimple /></button><button className="text-btn" onClick={() => saveJSON(selected)}>Export JSON <DownloadSimple /></button><button className="text-btn" onClick={() => setSelectedId(null)}>Close report</button></div><pre>{agentReportMarkdown(selected)}</pre></div>}
  </section>;
}
