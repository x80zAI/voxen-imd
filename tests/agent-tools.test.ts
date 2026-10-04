import { afterEach, describe, expect, it, vi } from 'vitest';
import { AGENTS, AGENT_HISTORY_LIMIT, agentReportMarkdown, appendAgentReport, buildAgentReport, executeAgent, lastSuccessfulReport, loadAgentHistory, saveAgentHistory, unavailableReport, validateSavedReport } from '../src/agent-tools';
import type { AgentReport } from '../src/agent-tools';
import type { Envelope, Publication } from '../src/lib';

const ACQUIRED = '2026-10-04T15:00:00.000Z', NEWER = '2026-10-04T15:01:00.000Z';
const POOL = `0x${'a'.repeat(40)}`;
const market = (fields: Record<string, unknown> = {}, fetchedAt = ACQUIRED): Envelope<unknown> => ({ kind: 'market', fetchedAt, source: AGENTS['market-watch'].source, data: { pairs: [{ id: POOL, dex: 'uniswap', quote: 'WETH', priceUsd: 0.12, liquidityUsd: 100, volume24h: 50, change24h: -2, buys24h: 0, sells24h: null, url: 'https://dexscreener.com/ethereum/pool', ...fields }] } });
const publication = (id: string, title = 'Ethereum research'): Publication => ({ id, objective: title, type: 'research', state: 'completed', deliveredAt: ACQUIRED, jobId: null, repoUrl: null, siteUrl: null, commit: null, files: [], chains: [] });
const publications = (items = [publication('record-a')], fetchedAt = ACQUIRED): Envelope<unknown> => ({ kind: 'publications', source: AGENTS['publication-watch'].source, fetchedAt, data: { count: 50, totalPages: 5, page: 1, items } });
const swarm = (fields: Record<string, unknown> = {}, fetchedAt = ACQUIRED): Envelope<unknown> => ({ kind: 'swarm', source: AGENTS['network-brief'].source, fetchedAt, data: { online: 0, working: 2, accepted24h: 4, seats: null, workers: [{ tokenId: '42', agentId: null, working: true, skills: ['research'], lastSeenAt: ACQUIRED }], ...fields } });

afterEach(() => vi.unstubAllGlobals());

describe('agent source validation and comparisons', () => {
  it('preserves real zero values and missing figures without inventing a total', () => {
    const report = buildAgentReport('market-watch', market({ liquidityUsd: null, priceUsd: 0 }));
    expect(report.status).toBe('partial');
    if (report.status === 'unavailable' || report.kind !== 'market-watch') throw new Error('Wrong report');
    expect(report.facts.pools[0].priceUsd).toBe(0);
    expect(report.facts.pools[0].liquidityUsd).toBeNull();
    expect(report.facts.liquiditySumUsd).toBeNull();
    expect(agentReportMarkdown(report)).toContain('Liquidity: Unavailable');
    expect(agentReportMarkdown(report)).toContain('24-hour buys / sells: 0 / Unavailable');
  });
  it('rejects non-finite figures, duplicate pools and invalid source identities', () => {
    for (const value of [NaN, Infinity, -1, '100']) expect(() => buildAgentReport('market-watch', market({ liquidityUsd: value }))).toThrow('validated');
    for (const source of ['http://api.dexscreener.com/latest/dex/tokens/a', 'https://user:secret@api.dexscreener.com/latest/dex/tokens/a', 'https://evil.invalid/market', AGENTS['market-watch'].source + '?url=https://evil.invalid']) {
      expect(() => buildAgentReport('market-watch', { ...market(), source })).toThrow('validated');
    }
    const one = market();
    const pair = (one.data as { pairs: unknown[] }).pairs[0];
    expect(() => buildAgentReport('market-watch', { ...one, data: { pairs: [pair, pair] } })).toThrow('validated');
  });
  it('calculates differences only for a newer source reading and matching pools', () => {
    const previous = buildAgentReport('market-watch', market({ volume24h: null }));
    const fresh = buildAgentReport('market-watch', market({ priceUsd: 0.15, liquidityUsd: 125 }, NEWER), previous);
    if (fresh.status === 'unavailable' || fresh.kind !== 'market-watch') throw new Error('Wrong report');
    expect(fresh.facts.deltas?.[0].liquidityUsd).toBe(25);
    expect(fresh.facts.deltas?.[0].priceUsd).toBeCloseTo(0.03);
    expect(fresh.facts.deltas?.[0].volume24h).toBeNull();
    const reused = buildAgentReport('market-watch', market(), previous);
    const older = buildAgentReport('market-watch', market({}, '2026-10-04T14:00:00.000Z'), previous);
    for (const report of [reused, older]) {
      if (report.status === 'unavailable' || report.kind !== 'market-watch') throw new Error('Wrong report');
      expect(report.facts.deltas).toBeNull();
    }
    expect(agentReportMarkdown(reused)).toContain('reused the same acquired source reading');
    expect(agentReportMarkdown(older)).toContain('predates the previous successful reading');
    expect(lastSuccessfulReport([previous, fresh, older], 'market-watch')?.id).toBe(fresh.id);
  });
  it('limits publication changes to the eligible first page without claiming deletion', () => {
    const previous = buildAgentReport('publication-watch', publications([publication('a'), publication('b')]));
    const report = buildAgentReport('publication-watch', publications([publication('b'), publication('c'), publication('hidden', 'A sandbox application')], NEWER), previous);
    if (report.status === 'unavailable' || report.kind !== 'publication-watch') throw new Error('Wrong report');
    expect(report.facts.items.map(item => item.id)).toEqual(['b', 'c']);
    expect(report.facts.appeared).toEqual(['c']);
    expect(report.facts.leftPage).toEqual(['a']);
    expect(report.facts.sourceCount).toBe(50);
    expect(agentReportMarkdown(report)).toContain('does not establish deletion');
    expect(agentReportMarkdown(report)).toContain('source page 1');
    expect(() => buildAgentReport('publication-watch', { ...publications(), data: { count: 5, totalPages: 1, page: 2, items: [] } })).toThrow('validated');
  });
  it('escapes untrusted Markdown labels and rejects unsafe source links', () => {
    const report = buildAgentReport('publication-watch', publications([publication('r', '<script>bad()</script> [open](javascript:alert(1))')]));
    const markdown = agentReportMarkdown(report);
    expect(markdown).not.toContain('<script>');
    expect(markdown).not.toContain('[open](javascript:');
    expect(markdown).toContain('\\<script\\>');
    const bad = { ...publication('r'), repoUrl: 'https://github.com@evil.invalid/repo' };
    expect(() => buildAgentReport('publication-watch', publications([bad]))).toThrow('validated');
  });
  it('validates counters and worker records while distinguishing partial network reads', () => {
    const report = buildAgentReport('network-brief', swarm());
    expect(report.status).toBe('partial');
    if (report.status === 'unavailable' || report.kind !== 'network-brief') throw new Error('Wrong report');
    expect(report.facts.online).toBe(0);
    expect(report.facts.workerRecords).toBe(1);
    expect(agentReportMarkdown(report)).toContain('Enrolled seats reported: Unavailable');
    expect(() => buildAgentReport('network-brief', swarm({ workers: [{ tokenId: '2000', working: true, skills: [], agentId: null, lastSeenAt: null }] }))).toThrow('validated');
    expect(() => buildAgentReport('network-brief', swarm({ online: 1.2 }))).toThrow('validated');
  });
});

describe('bounded, validated device history', () => {
  it('retains ten actual reports and preserves the latest successful reading after a failure', () => {
    let history: AgentReport[] = [];
    for (let index = 0; index < 12; index++) history = appendAgentReport(history, buildAgentReport('market-watch', market()));
    expect(history).toHaveLength(AGENT_HISTORY_LIMIT);
    const previous = lastSuccessfulReport(history, 'market-watch');
    history = appendAgentReport(history, unavailableReport('market-watch', new Error('Source unavailable.')));
    expect(history).toHaveLength(10);
    expect(lastSuccessfulReport(history, 'market-watch')?.id).toBe(previous?.id);
    const failure = history[history.length - 1];
    expect(failure.readingAt).toBeNull();
    expect(agentReportMarkdown(failure)).toContain('No accepted source reading or new network figures');
  });
  it('ignores malformed or oversized storage without manufacturing reports', () => {
    for (const raw of ['bad JSON', '{"version":2,"reports":[]}', JSON.stringify({ version: 1, reports: [{ kind: 'market-watch', status: 'complete' }] }), 'x'.repeat(650_001)]) {
      const loaded = loadAgentHistory({ getItem: () => raw });
      expect(loaded.reports).toEqual([]); expect(loaded.issue).not.toBeNull();
    }
    expect(loadAgentHistory({ getItem: () => { throw new Error('Access denied'); } }).reports).toEqual([]);
  });
  it('round-trips validated records and reports storage quota failures truthfully', () => {
    const report = buildAgentReport('network-brief', swarm()), saved: { text: string | null } = { text: null };
    expect(saveAgentHistory({ setItem: (_key, value) => { saved.text = value; } }, [report])).toBe(true);
    const loaded = loadAgentHistory({ getItem: () => saved.text });
    expect(loaded.issue).toBeNull(); expect(loaded.reports).toEqual([report]);
    expect(saveAgentHistory({ setItem: () => { throw new Error('Quota'); } }, [report])).toBe(false);
    expect(report.status).toBe('partial');
    expect(saveAgentHistory(null, [report])).toBe(false);
  });
  it('rejects manipulated totals, impossible status labels and unsafe stored URLs', () => {
    const report = buildAgentReport('market-watch', market());
    if (report.status === 'unavailable' || report.kind !== 'market-watch') throw new Error('Wrong report');
    expect(() => validateSavedReport({ ...report, facts: { ...report.facts, liquiditySumUsd: 999 } })).toThrow('validated');
    expect(() => validateSavedReport({ ...report, status: 'partial' })).toThrow('validated');
    expect(() => validateSavedReport({ ...report, source: 'javascript:alert(1)' })).toThrow('validated');
    const parsed = validateSavedReport({ ...report, unwanted: '<script>bad</script>' });
    expect(parsed).not.toHaveProperty('unwanted');
  });
});

describe('actual read execution and cancellation', () => {
  it('uses the existing data reader and forwards its AbortSignal', async () => {
    const signal = new AbortController().signal;
    const fetcher = vi.fn(async () => new Response(JSON.stringify(market()), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    const report = await executeAgent('market-watch', null, signal);
    expect(fetcher).toHaveBeenCalledWith('/api/data?kind=market', { signal });
    expect(report.readingAt).toBe(ACQUIRED);
  });
  it('does not return a report after an execution was cancelled', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', async () => { controller.abort(); return new Response(JSON.stringify(market()), { status: 200 }); });
    await expect(executeAgent('market-watch', null, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('allows independent executions to complete when another source fails', async () => {
    vi.stubGlobal('fetch', async (input: string) => {
      if (input.includes('kind=publications')) return new Response(JSON.stringify({ message: 'Source unavailable.' }), { status: 503 });
      return new Response(JSON.stringify(input.includes('kind=market') ? market() : swarm()), { status: 200 });
    });
    const results = await Promise.allSettled(['market-watch', 'publication-watch', 'network-brief'].map(kind => executeAgent(kind as AgentReport['kind'], null)));
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
  });
});
