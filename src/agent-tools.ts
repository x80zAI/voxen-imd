import { IMD, publishedWorkAllowed, read, safeLink } from './lib';
import type { Envelope } from './lib';

export const AGENT_KINDS = ['market-watch', 'publication-watch', 'network-brief'] as const;
export type AgentKind = typeof AGENT_KINDS[number];
export const AGENT_HISTORY_KEY = 'voxen-imd-agent-history-v1';
export const AGENT_HISTORY_LIMIT = 10;
export const AGENT_INTERVAL_MS = 60_000;
const MAX_SAVED_BYTES = 650_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POOL_ID = /^0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const MARKET_SOURCE = `https://api.dexscreener.com/latest/dex/tokens/${IMD.toLowerCase()}`;
const PUBLICATION_SOURCE = 'https://api.imd.fun/publications?q=&type=all&page=1&pageSize=12&sort=newest';

export const AGENTS: Record<AgentKind, { title: string; description: string; source: string }> = {
  'market-watch': { title: 'Market Watch', description: 'Read IMD pools and compare their reported figures with the previous reading.', source: MARKET_SOURCE },
  'publication-watch': { title: 'Publication Watch', description: 'Check eligible records on the newest publication page and identify changes in that page.', source: PUBLICATION_SOURCE },
  'network-brief': { title: 'Network Brief', description: 'Summarize validated network counters and the returned worker records.', source: 'https://api.imd.fun/swarm' },
};

export type AgentPool = {
  id: string; dex: string | null; quote: string | null; source: string;
  priceUsd: number | null; liquidityUsd: number | null; volume24h: number | null;
  change24h: number | null; buys24h: number | null; sells24h: number | null;
};
export type AgentPublication = {
  id: string; title: string; type: string | null; state: string | null; deliveredAt: string | null;
  jobId: string | null; repository: string | null; website: string | null;
};
export type MarketFacts = { pools: AgentPool[]; liquiditySumUsd: number | null; volumeSum24hUsd: number | null; deltas: { id: string; priceUsd: number | null; liquidityUsd: number | null; volume24h: number | null }[] | null };
export type PublicationFacts = { sourceCount: number; sourcePages: number; items: AgentPublication[]; appeared: string[] | null; leftPage: string[] | null };
export type NetworkFacts = { online: number | null; working: number | null; accepted24h: number | null; seats: number | null; workerRecords: number; deltas: { online: number | null; working: number | null; accepted24h: number | null; seats: number | null } | null };
type BaseReport = { version: 1; id: string; kind: AgentKind; executedAt: string; source: string; readingAt: string; comparisonAt: string | null; readingOrder: 'initial' | 'newer' | 'same' | 'older'; status: 'complete' | 'partial' };
export type AgentReport =
  | (BaseReport & { kind: 'market-watch'; facts: MarketFacts })
  | (BaseReport & { kind: 'publication-watch'; facts: PublicationFacts })
  | (BaseReport & { kind: 'network-brief'; facts: NetworkFacts })
  | { version: 1; id: string; kind: AgentKind; executedAt: string; source: string; readingAt: null; status: 'unavailable'; error: string };

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = (): never => { throw new Error('The source response could not be validated.'); };
function string(value: unknown, limit: number, nullable = false): string | null {
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > limit) return invalid();
  return value;
}
function number(value: unknown, nullable = false, negative = false, integer = false): number | null {
  if (value === null && nullable) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || (!negative && value < 0) || (integer && !Number.isSafeInteger(value))) return invalid();
  return value;
}
function date(value: unknown, nullable = false): string | null {
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) return invalid();
  return new Date(value).toISOString();
}
function url(value: unknown, host: string, nullable = false): string | null {
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || value.length > 2048) return invalid();
  const valid = safeLink(value);
  if (!valid) return invalid();
  const parsed = new URL(valid);
  if (parsed.port || (host.startsWith('.') ? !parsed.hostname.endsWith(host) : parsed.hostname !== host)) return invalid();
  return valid;
}
function source(value: unknown, kind: AgentKind): string {
  const expected = AGENTS[kind].source;
  const validated = url(value, kind === 'market-watch' ? 'api.dexscreener.com' : 'api.imd.fun')!;
  const supplied = new URL(validated), target = new URL(expected);
  if (supplied.pathname !== target.pathname || supplied.hash || supplied.searchParams.size !== target.searchParams.size
    || [...target.searchParams].some(([key, entry]) => supplied.searchParams.getAll(key).length !== 1 || supplied.searchParams.get(key) !== entry)) return invalid();
  return validated;
}
function nullableSum(values: (number | null)[]): number | null {
  if (values.some(value => value === null)) return null;
  const sum = values.reduce<number>((total, value) => total + (value ?? 0), 0);
  return Number.isFinite(sum) ? sum : null;
}
function delta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  const difference = current - previous;
  return Number.isFinite(difference) ? difference : null;
}
function array(value: unknown, limit: number): unknown[] {
  if (!Array.isArray(value) || value.length > limit) return invalid();
  return value;
}
function pool(value: unknown): AgentPool {
  if (!object(value) || typeof value.id !== 'string' || !POOL_ID.test(value.id)) return invalid();
  return { id: value.id, dex: string(value.dex, 40, true), quote: string(value.quote, 40, true), source: url(value.url ?? value.source, 'dexscreener.com')!,
    priceUsd: number(value.priceUsd, true), liquidityUsd: number(value.liquidityUsd, true), volume24h: number(value.volume24h, true),
    change24h: number(value.change24h, true, true), buys24h: number(value.buys24h, true, false, true), sells24h: number(value.sells24h, true, false, true) };
}
function publication(value: unknown): AgentPublication {
  if (!object(value)) return invalid();
  const jobId = string(value.jobId, 36, true);
  if (jobId && !UUID.test(jobId)) return invalid();
  return { id: string(value.id, 100)!, title: string(value.objective ?? value.title, 4000)!,
    type: string(value.type, 120, true), state: string(value.state, 80, true), deliveredAt: date(value.deliveredAt, true), jobId,
    repository: url(value.repoUrl ?? value.repository ?? null, 'github.com', true), website: url(value.siteUrl ?? value.website ?? null, '.sites.imd.fun', true) };
}
function unique(values: string[]): boolean { return new Set(values.map(value => value.toLowerCase())).size === values.length; }
function base(kind: AgentKind, envelope: Envelope<unknown>, previous: AgentReport | null, executedAt: string): BaseReport {
  const readingAt = date(envelope.fetchedAt)!;
  const comparisonAt = previous?.status !== 'unavailable' && previous?.kind === kind ? previous?.readingAt ?? null : null;
  const order = comparisonAt === null ? 'initial' : readingAt === comparisonAt ? 'same' : Date.parse(readingAt) > Date.parse(comparisonAt) ? 'newer' : 'older';
  return { version: 1, id: crypto.randomUUID(), kind, executedAt: date(executedAt)!, source: source(envelope.source, kind), readingAt, comparisonAt, readingOrder: order, status: 'complete' };
}

export function buildAgentReport(kind: AgentKind, envelope: Envelope<unknown>, previous: AgentReport | null = null, executedAt = new Date().toISOString()): AgentReport {
  const expectedKind = kind === 'market-watch' ? 'market' : kind === 'publication-watch' ? 'publications' : 'swarm';
  if (envelope.kind !== expectedKind || !object(envelope.data)) return invalid();
  const common = base(kind, envelope, previous, executedAt), data = envelope.data;
  if (kind === 'market-watch') {
    const pools = array(data.pairs, 100).map(pool);
    if (!unique(pools.map(item => item.id))) return invalid();
    const older = common.readingOrder === 'newer' && previous?.kind === kind && previous.status !== 'unavailable' ? previous.facts.pools : null;
    const previousPools = older ? new Map(older.map(item => [item.id.toLowerCase(), item])) : null;
    const deltas = previousPools ? pools.flatMap(item => {
      const last = previousPools.get(item.id.toLowerCase());
      return last ? [{ id: item.id, priceUsd: delta(item.priceUsd, last.priceUsd), liquidityUsd: delta(item.liquidityUsd, last.liquidityUsd), volume24h: delta(item.volume24h, last.volume24h) }] : [];
    }) : null;
    const liquiditySumUsd = nullableSum(pools.map(item => item.liquidityUsd)), volumeSum24hUsd = nullableSum(pools.map(item => item.volume24h));
    const partial = pools.some(item => [item.priceUsd, item.liquidityUsd, item.volume24h].some(metric => metric === null)) || liquiditySumUsd === null || volumeSum24hUsd === null;
    return { ...common, kind, status: partial ? 'partial' : 'complete', facts: { pools, liquiditySumUsd, volumeSum24hUsd, deltas } };
  }
  if (kind === 'publication-watch') {
    if (data.page !== 1) return invalid();
    const raw = array(data.items, 12);
    const items = raw.flatMap(item => {
      if (!object(item)) return invalid();
      const normalized = publication(item), chains = array(item.chains, 200).map(chain => number(chain, false, false, true)!);
      return publishedWorkAllowed({ objective: normalized.title, chains }) ? [normalized] : [];
    });
    if (!unique(items.map(item => item.id))) return invalid();
    const old = common.readingOrder === 'newer' && previous?.kind === kind && previous.status !== 'unavailable' ? previous.facts.items : null;
    const before = old ? new Set(old.map(item => item.id)) : null, current = new Set(items.map(item => item.id));
    return { ...common, kind, status: items.some(item => item.state === null) ? 'partial' : 'complete', facts: {
      sourceCount: number(data.count, false, false, true)!, sourcePages: number(data.totalPages, false, false, true)!, items,
      appeared: before ? items.filter(item => !before.has(item.id)).map(item => item.id) : null,
      leftPage: old ? old.filter(item => !current.has(item.id)).map(item => item.id) : null,
    } };
  }
  const facts: NetworkFacts = { online: number(data.online, true, false, true), working: number(data.working, true, false, true), accepted24h: number(data.accepted24h, true, false, true), seats: number(data.seats, true, false, true), workerRecords: array(data.workers, 2000).length, deltas: null };
  for (const worker of data.workers as unknown[]) {
    if (!object(worker) || typeof worker.tokenId !== 'string' || !/^(?:0|[1-9]\d{0,3})$/.test(worker.tokenId) || Number(worker.tokenId) > 1999
      || (worker.working !== null && typeof worker.working !== 'boolean') || !Array.isArray(worker.skills) || worker.skills.some(skill => typeof skill !== 'string' || skill.length > 120)) return invalid();
    string(worker.agentId, 80, true); date(worker.lastSeenAt, true);
  }
  if (common.readingOrder === 'newer' && previous?.kind === kind && previous.status !== 'unavailable') {
    facts.deltas = { online: delta(facts.online, previous.facts.online), working: delta(facts.working, previous.facts.working), accepted24h: delta(facts.accepted24h, previous.facts.accepted24h), seats: delta(facts.seats, previous.facts.seats) };
  }
  return { ...common, kind, status: [facts.online, facts.working, facts.accepted24h, facts.seats].some(metric => metric === null) ? 'partial' : 'complete', facts };
}

export async function executeAgent(kind: AgentKind, previous: AgentReport | null, signal?: AbortSignal): Promise<AgentReport> {
  const route = kind === 'market-watch' ? 'market' : kind === 'publication-watch' ? 'publications' : 'swarm';
  const response = await read<unknown>(route, kind === 'publication-watch' ? { q: '', type: 'all', page: '1' } : {}, signal);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  return buildAgentReport(kind, response, previous);
}
export function unavailableReport(kind: AgentKind, reason: unknown, executedAt = new Date().toISOString()): AgentReport {
  const error = reason instanceof Error && reason.message.trim() ? reason.message.slice(0, 500) : 'The source is unavailable. No accepted reading was returned.';
  return { version: 1, id: crypto.randomUUID(), kind, executedAt: date(executedAt)!, source: AGENTS[kind].source, readingAt: null, status: 'unavailable', error };
}
export function lastSuccessfulReport(history: AgentReport[], kind: AgentKind): AgentReport | null {
  let latest: AgentReport | null = null;
  for (const report of history) {
    if (report.kind !== kind || report.status === 'unavailable') continue;
    if (!latest || Date.parse(report.readingAt) >= Date.parse(latest.readingAt!)) latest = report;
  }
  return latest;
}

function optionalIds(value: unknown): string[] | null {
  if (value === null) return null;
  const ids = array(value, 12).map(entry => string(entry, 100)!);
  if (!unique(ids)) return invalid();
  return ids;
}
export function validateSavedReport(value: unknown): AgentReport {
  if (!object(value) || value.version !== 1 || typeof value.kind !== 'string' || !AGENT_KINDS.includes(value.kind as AgentKind)
    || typeof value.id !== 'string' || !UUID.test(value.id)) return invalid();
  const kind = value.kind as AgentKind, executedAt = date(value.executedAt)!, sourceUrl = source(value.source, kind);
  if (value.status === 'unavailable') {
    if (value.readingAt !== null) return invalid();
    return { version: 1, id: value.id, kind, executedAt, source: sourceUrl, readingAt: null, status: 'unavailable', error: string(value.error, 500)! };
  }
  if (!['complete', 'partial'].includes(String(value.status)) || !object(value.facts)) return invalid();
  const readingAt = date(value.readingAt)!, comparisonAt = date(value.comparisonAt, true);
  const order = comparisonAt === null ? 'initial' : readingAt === comparisonAt ? 'same' : Date.parse(readingAt) > Date.parse(comparisonAt) ? 'newer' : 'older';
  if (value.readingOrder !== order) return invalid();
  const common: BaseReport = { version: 1, id: value.id, kind, executedAt, source: sourceUrl, readingAt, comparisonAt, readingOrder: order, status: value.status as 'complete' | 'partial' }, f = value.facts;
  if (kind === 'market-watch') {
    const pools = array(f.pools, 100).map(pool);
    if (!unique(pools.map(item => item.id))) return invalid();
    const deltas = f.deltas === null ? null : array(f.deltas, 100).map(entry => {
      if (!object(entry) || typeof entry.id !== 'string' || !pools.some(item => item.id === entry.id)) return invalid();
      return { id: entry.id, priceUsd: number(entry.priceUsd, true, true), liquidityUsd: number(entry.liquidityUsd, true, true), volume24h: number(entry.volume24h, true, true) };
    });
    if ((order !== 'newer' && deltas !== null) || (deltas && !unique(deltas.map(entry => entry.id)))) return invalid();
    const liquiditySumUsd = number(f.liquiditySumUsd, true), volumeSum24hUsd = number(f.volumeSum24hUsd, true);
    if (liquiditySumUsd !== nullableSum(pools.map(item => item.liquidityUsd)) || volumeSum24hUsd !== nullableSum(pools.map(item => item.volume24h))) return invalid();
    const partial = pools.some(item => [item.priceUsd, item.liquidityUsd, item.volume24h].some(metric => metric === null)) || liquiditySumUsd === null || volumeSum24hUsd === null;
    if (common.status !== (partial ? 'partial' : 'complete')) return invalid();
    return { ...common, kind, facts: { pools, liquiditySumUsd, volumeSum24hUsd, deltas } };
  }
  if (kind === 'publication-watch') {
    const items = array(f.items, 12).map(publication), appeared = optionalIds(f.appeared), leftPage = optionalIds(f.leftPage);
    if (!unique(items.map(item => item.id)) || (appeared && appeared.some(id => !items.some(item => item.id === id)))
      || (order !== 'newer' && (appeared !== null || leftPage !== null))) return invalid();
    if (items.some(item => !publishedWorkAllowed({ objective: item.title, chains: [] }))
      || common.status !== (items.some(item => item.state === null) ? 'partial' : 'complete')) return invalid();
    return { ...common, kind, facts: { sourceCount: number(f.sourceCount, false, false, true)!, sourcePages: number(f.sourcePages, false, false, true)!, items, appeared, leftPage } };
  }
  const deltas = f.deltas === null ? null : (() => {
    if (!object(f.deltas) || order !== 'newer') return invalid();
    return { online: number(f.deltas.online, true, true, true), working: number(f.deltas.working, true, true, true), accepted24h: number(f.deltas.accepted24h, true, true, true), seats: number(f.deltas.seats, true, true, true) };
  })();
  const facts = { online: number(f.online, true, false, true), working: number(f.working, true, false, true), accepted24h: number(f.accepted24h, true, false, true), seats: number(f.seats, true, false, true), workerRecords: number(f.workerRecords, false, false, true)!, deltas };
  if (facts.workerRecords > 2000 || common.status !== ([facts.online, facts.working, facts.accepted24h, facts.seats].some(metric => metric === null) ? 'partial' : 'complete')) return invalid();
  return { ...common, kind, facts };
}
export function appendAgentReport(history: AgentReport[], report: AgentReport): AgentReport[] {
  const validated = validateSavedReport(report);
  return [...history, validated].slice(-AGENT_HISTORY_LIMIT);
}
export type HistoryLoad = { reports: AgentReport[]; issue: string | null };
export function loadAgentHistory(storage: Pick<Storage, 'getItem'> | null): HistoryLoad {
  try {
    if (!storage) return { reports: [], issue: 'Device storage is unavailable. Reports can still be kept in this session.' };
    const raw = storage.getItem(AGENT_HISTORY_KEY);
    if (raw === null) return { reports: [], issue: null };
    if (raw.length > MAX_SAVED_BYTES) throw new Error('Oversized history');
    const saved: unknown = JSON.parse(raw);
    if (!object(saved) || saved.version !== 1 || !Array.isArray(saved.reports) || saved.reports.length > AGENT_HISTORY_LIMIT) throw new Error('Invalid history');
    const reports = saved.reports.map(validateSavedReport);
    if (!unique(reports.map(report => report.id))) throw new Error('Duplicate report');
    return { reports, issue: null };
  } catch { return { reports: [], issue: 'Saved history could not be read and was ignored. New reports remain available in this session.' }; }
}
export function saveAgentHistory(storage: Pick<Storage, 'setItem'> | null, history: AgentReport[]): boolean {
  try {
    if (!storage) return false;
    const reports = history.slice(-AGENT_HISTORY_LIMIT).map(validateSavedReport), encoded = JSON.stringify({ version: 1, reports });
    if (encoded.length > MAX_SAVED_BYTES) return false;
    storage.setItem(AGENT_HISTORY_KEY, encoded); return true;
  } catch { return false; }
}

const markdownText = (value: string) => Array.from(value, character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? ' ' : character).join('').replace(/[\\`*_{}[\]()#+.!|<>]/g, '\\$&');
const mdLink = (label: string, value: string) => `[${markdownText(label)}](<${value.replace(/[<>]/g, character => encodeURIComponent(character))}>)`;
function metric(value: number | null, usd = false): string { return value === null ? 'Unavailable' : usd ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 8 }).format(value) : new Intl.NumberFormat('en-US').format(value); }
function difference(value: number | null, usd = false): string { return value === null ? 'Unavailable' : `${value > 0 ? '+' : ''}${metric(value, usd)}`; }
export function agentReportMarkdown(input: AgentReport): string {
  const report = validateSavedReport(input), lines = [`# VOXEN IMD — ${AGENTS[report.kind].title}`, '', `Executed at: ${report.executedAt}`, `Status: ${report.status === 'unavailable' ? 'Source unavailable' : report.status === 'partial' ? 'Partial reading' : 'Reading accepted'}`, '', mdLink('Requested source', report.source)];
  if (report.status === 'unavailable') return [...lines, '', markdownText(report.error), '', 'No accepted source reading or new network figures are reported for this attempt.', 'Earlier successful reports remain separate.', ''].join('\n');
  lines.push(`Source acquired at: ${report.readingAt}`, '', 'The acquisition time identifies the returned reading, not the time of an underlying market or network event.');
  if (report.readingOrder === 'same') lines.push('This execution reused the same acquired source reading. No independent change is inferred.');
  else if (report.readingOrder === 'older') lines.push('This source reading predates the previous successful reading. Changes are not calculated.');
  else if (report.comparisonAt) lines.push(`Compared with the reading acquired at: ${report.comparisonAt}`);
  else lines.push('No earlier successful reading is available for a change comparison.');
  if (report.kind === 'market-watch') {
    const f = report.facts;
    lines.push('', '## Reported IMD pools', `Official Ethereum token: ${IMD}`, `Qualifying pools returned: ${f.pools.length}`, `Sum of reported liquidity in these pools: ${metric(f.liquiditySumUsd, true)}`, `Sum of reported 24-hour volume in these pools: ${metric(f.volumeSum24hUsd, true)}`, '');
    if (f.pools.length === 0) lines.push('The accepted response contained no qualifying pool records.');
    for (const p of f.pools) {
      lines.push(`### ${markdownText(p.dex ?? 'DEX unavailable')} / ${markdownText(p.quote ?? 'Quote unavailable')}`, `Pool: ${p.id}`, `IMD price: ${metric(p.priceUsd, true)}`, `Liquidity: ${metric(p.liquidityUsd, true)}`, `24-hour volume: ${metric(p.volume24h, true)}`, `24-hour price change: ${p.change24h === null ? 'Unavailable' : `${p.change24h}%`}`, `24-hour buys / sells: ${metric(p.buys24h)} / ${metric(p.sells24h)}`, mdLink('Original pool record', p.source));
      const d = f.deltas?.find(item => item.id === p.id);
      if (d) lines.push(`Difference from previous reading — price: ${difference(d.priceUsd, true)}; liquidity: ${difference(d.liquidityUsd, true)}; rolling 24-hour volume: ${difference(d.volume24h, true)}`);
      lines.push('');
    }
    lines.push('Coverage is limited to the returned provider list, capped at 100 matching candidates. Rolling-window differences are not new trading volume or investment returns. Missing values remain unavailable. This report supplies no trading recommendation.');
  } else if (report.kind === 'publication-watch') {
    const f = report.facts;
    lines.push('', '## Newest publication page', 'Scope: source page 1, newest order, at most 12 returned records before the existing eligibility policy.', `Eligible visible records: ${f.items.length}`, `Total records / pages reported by the source index: ${f.sourceCount} / ${f.sourcePages}`, 'These totals describe the upstream index, not a complete count of eligible work.');
    if (f.appeared !== null) lines.push(`IDs newly appearing in this page: ${f.appeared.length}`, `IDs no longer present in this page: ${f.leftPage?.length ?? 0}`, 'An ID leaving this page does not establish deletion; it may have moved to another source page.');
    if (f.items.length === 0) lines.push('No eligible records were present in the accepted first-page reading.');
    for (const p of f.items) {
      lines.push('', `### ${markdownText(p.title)}`, `Record ID: ${markdownText(p.id)}`, `Type: ${markdownText(p.type ?? 'Unavailable')}`, `Reported state: ${markdownText(p.state ?? 'Unavailable')}`, `Published at: ${p.deliveredAt ?? 'Unavailable'}`);
      if (f.appeared?.includes(p.id)) lines.push('This ID newly appeared in the compared first-page reading.');
      if (p.jobId) lines.push(mdLink('Official job record', `https://api.imd.fun/jobs/${p.jobId}/result`));
      if (p.repository) lines.push(mdLink('Original repository', p.repository));
      if (p.website) lines.push(mdLink('Recorded website', p.website));
    }
    lines.push('', 'This is a bounded index comparison. A publication or recorded status does not certify its quality, safety or availability.');
  } else {
    const f = report.facts;
    lines.push('', '## Network counters', `Agents reported online: ${metric(f.online)}`, `Work reported in progress: ${metric(f.working)}`, `Accepted work reported in 24 hours: ${metric(f.accepted24h)}`, `Enrolled seats reported: ${metric(f.seats)}`, `Validated worker records returned: ${f.workerRecords}`);
    if (f.deltas) lines.push('', 'Differences from the previous acquired reading:', `Online: ${difference(f.deltas.online)}`, `Working: ${difference(f.deltas.working)}`, `Rolling 24-hour accepted count: ${difference(f.deltas.accepted24h)}`, `Enrolled seats: ${difference(f.deltas.seats)}`);
    lines.push('', 'The combined reader requires both network health and worker data to validate. These counters are source records, not measures of agent competence, guaranteed availability or profitability.');
  }
  lines.push('', 'Generated by rule-based analysis of the accepted public reading. Kept on this device; scheduled checks run only while this page is open and visible.', '');
  return lines.join('\n');
}
