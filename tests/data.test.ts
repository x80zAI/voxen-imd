import { describe, expect, it, vi } from 'vitest';
import { createDataHandler, createDataReader, normalizeJob, normalizeMarket, normalizePublications,
  normalizeSeat, normalizeSwarm, parseQuery } from '../api/data.mjs';

const IMD = '0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7';
const JOB = '9ba0e6d1-f90f-46fe-b0a9-2851b0b45c94';
const HASH = 'dcb08e7d13923b139b717bb30cb3ac967328dd3de155d385426339d1a7854907';
const PAIR = `0x${'a'.repeat(64)}`;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
});
const marketPair = (extra: Record<string, unknown> = {}) => ({
  chainId: 'ethereum', dexId: 'uniswap', pairAddress: PAIR, baseToken: { address: IMD, symbol: 'IMD' },
  quoteToken: { address: `0x${'b'.repeat(40)}`, symbol: 'WETH' },
  url: `https://dexscreener.com/ethereum/${PAIR}`, priceUsd: '0.325', liquidity: { usd: 1245 },
  volume: { h24: 450 }, priceChange: { h24: -8.5 }, txns: { h24: { buys: 3, sells: 5 } }, ...extra,
});
function responseRecorder() {
  return { statusCode: 0, headers: {} as Record<string, string>, body: '',
    setHeader(name: string, value: string) { this.headers[name] = value; },
    end(body: string) { this.body = body; },
  };
}

describe('fixed source routing', () => {
  it('allows verified seat zero and collection end, rejecting outside IDs', () => {
    expect(parseQuery('/api/data?kind=seat&id=0').id).toBe('0');
    expect(parseQuery('/api/data?kind=seat&id=1999').id).toBe('1999');
    for (const value of ['2000', '-1', '01', '1.2', '1e3', 'abc', '']) {
      expect(() => parseQuery(`/api/data?kind=seat&id=${value}`)).toThrow();
    }
  });
  it('refuses arbitrary URLs, extra query arguments and duplicate input', () => {
    for (const query of ['kind=market&url=https://localhost', 'kind=market&kind=swarm',
      'kind=publications&page=1&page=2', 'kind=seat&id=42&method=POST', 'kind=unknown']) {
      expect(() => parseQuery(`/api/data?${query}`)).toThrow();
    }
  });
  it('restricts jobs to a full UUID', () => {
    expect(parseQuery(`/api/data?kind=job&id=${JOB.toUpperCase()}`).id).toBe(JOB);
    expect(() => parseQuery('/api/data?kind=job&id=../../health')).toThrow();
    expect(() => parseQuery(`/api/data?kind=job&id=${JOB}extra`)).toThrow();
  });
  it('bounds search and page input and keeps search text safely encoded', () => {
    expect(parseQuery('/api/data?kind=publications&q=a%26type%3Dcode&type=all&page=2').source)
      .toContain('q=a%26type%3Dcode&type=all&page=2&pageSize=12');
    for (const query of ['q=' + 'a'.repeat(201), 'q=a%00b', 'page=0', 'page=1001', 'type=wallets', 'pageSize=100']) {
      expect(() => parseQuery(`/api/data?kind=publications&${query}`)).toThrow();
    }
  });
});

describe('market authenticity and missing data', () => {
  it('keeps Ethereum pairs with the exact official base address only', () => {
    const payload = { pairs: [marketPair(), marketPair({ chainId: 'base' }),
      marketPair({ baseToken: { address: `0x${'c'.repeat(40)}`, symbol: 'IMD' }, quoteToken: { address: IMD, symbol: 'IMD' } }),
      marketPair({ baseToken: { address: `${IMD}1` } })] };
    const result = normalizeMarket(payload);
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0]).toMatchObject({ id: PAIR, priceUsd: 0.325, change24h: -8.5, buys24h: 3 });
    expect(result.pairs[0].url).toBe(`https://dexscreener.com/ethereum/${PAIR}`);
  });
  it('preserves an actual zero but keeps missing, negative and nonfinite amounts unavailable', () => {
    const result = normalizeMarket({ pairs: [marketPair({ priceUsd: '', liquidity: { usd: -5 },
      volume: { h24: 'Infinity' }, txns: { h24: { buys: 0, sells: 1.5 } }, priceChange: { h24: null } })] });
    expect(result.pairs[0]).toMatchObject({ priceUsd: null, liquidityUsd: null, volume24h: null,
      change24h: null, buys24h: 0, sells24h: null });
  });
  it('refuses unsafe links and malformed payloads and deduplicates pools', () => {
    expect(normalizeMarket({ pairs: [marketPair(), marketPair(), marketPair({ url: 'javascript:alert(1)' })] }).pairs).toHaveLength(1);
    expect(() => normalizeMarket({ error: 'upstream' })).toThrow();
    expect(normalizeMarket({ pairs: [] }).pairs).toEqual([]);
  });
});

describe('official swarm and seat mapping', () => {
  it('uses the explicit daily acceptance count and actual worker heartbeat', () => {
    const result = normalizeSwarm({ health: { agentsOnline: 2, workingNow: 1, acceptedLastDay: 8, seatsEnrolled: 3 } },
      { workers: [{ seat: { tokenId: '0', agentId: '50906' }, working: 2, skills: ['research'], lastHeartbeatAt: '2026-10-04T00:00:00Z' }] });
    expect(result).toMatchObject({ online: 2, working: 1, accepted24h: 8, seats: 3 });
    expect(result.workers[0]).toMatchObject({ tokenId: '0', working: true, lastSeenAt: '2026-10-04T00:00:00.000Z' });
  });
  it('does not infer daily counts, heartbeats or zeroes from unrelated fields', () => {
    const result = normalizeSwarm({ health: { jobsDoneLastDay: 6 } },
      { workers: [{ seat: { tokenId: '42' }, skills: [], connectedAt: '2026-10-04T00:00:00Z' }] });
    expect(result).toMatchObject({ online: null, working: null, accepted24h: null, seats: null });
    expect(result.workers[0]).toMatchObject({ working: null, lastSeenAt: null });
    expect(() => normalizeSwarm({ health: { reachable: false } }, { workers: [] })).toThrow();
  });
  it('requires the returned seat to match the requested seat', () => {
    expect(() => normalizeSeat({ tokenId: '43', work: [] }, '42')).toThrow();
    expect(normalizeSeat({ tokenId: '42', accepted: 0, owner: 'bad address', work: [] }, '42'))
      .toMatchObject({ accepted: 0, attempts: null, owner: null, online: null, lastWorkedAt: null });
  });
  it('keeps actual work statuses and validates work IDs and timestamps', () => {
    const result = normalizeSeat({ tokenId: 42, work: [
      { jobId: JOB, objective: 'Recorded objective', status: 'accepted', submittedAt: '2026-10-03T22:28:34.314Z' },
      { jobId: '../../health', status: 'accepted' },
    ] }, '42');
    expect(result.work).toEqual([{ jobId: JOB, objective: 'Recorded objective', status: 'accepted', submittedAt: '2026-10-03T22:28:34.314Z' }]);
  });
});

describe('publication grouping and artifact verification metadata', () => {
  it('normalizes media-only publications without inventing completion or repository', () => {
    const result = normalizePublications({ count: 1, totalPages: 1, page: 1, items: [{ id: `job:${JOB}`, title: 'Actual image job',
      types: ['media'], publishedAt: '2026-10-04T00:57:54+02:00', versions: [], media: [{ jobId: JOB,
        files: [{ name: 'image', hash: HASH, bytes: 3754, mediaType: 'image/png' }] }] }] }, 1);
    expect(result.items[0]).toMatchObject({ jobId: JOB, type: 'media', state: null, repoUrl: null,
      deliveredAt: '2026-10-03T22:57:54.000Z' });
    expect(result.items[0].files[0].url).toBe(`https://api.imd.fun/artifacts/${HASH}`);
  });
  it('uses the latest project version and preserves actual contract chains and blocked state', () => {
    const result = normalizePublications({ count: 1, totalPages: 1, page: 1, items: [{ id: `workflow:${JOB}`, title: 'Actual project',
      types: ['contracts', 'sites'], release: { status: 'blocked' }, contracts: [{ chainId: 11155111 }],
      versions: [{ jobId: JOB, state: 'completed', commit: 'old' }, { jobId: JOB, state: 'blocked', commit: 'new' }],
      sites: [{ label: 'real-site', status: 'named' }] }] }, 1);
    expect(result.items[0]).toMatchObject({ state: 'blocked', commit: 'new', chains: [11155111], siteUrl: 'https://real-site.sites.imd.fun/' });
  });
  it('refuses unsafe names and links and mismatched pagination', () => {
    const result = normalizePublications({ count: 1, totalPages: 1, page: 1, items: [{ id: `job:${JOB}`, title: 'Actual project',
      versions: [{ jobId: JOB, repoUrl: 'https://github.com@evil.invalid/project' }], sites: [{ label: 'evil.invalid/x', status: 'named' }] }] }, 1);
    expect(result.items[0]).toMatchObject({ repoUrl: null, siteUrl: null });
    expect(() => normalizePublications({ count: 1, totalPages: 1, page: 2, items: [] }, 1)).toThrow();
  });
  it('checks job identity and only links exact official SHA-256 artifact URLs', () => {
    const result = normalizeJob({ jobId: JOB, state: 'completed', complete: true, files: [
      { name: 'report', hash: HASH, url: `/artifacts/${HASH}`, bytes: 7 },
      { name: 'unsafe', hash: HASH, url: 'https://evil.invalid/file', bytes: -1 },
      { name: 'bad hash', hash: 'invalid', url: `/artifacts/${HASH}` },
    ] }, JOB);
    expect(result.files[0]).toMatchObject({ hash: HASH, url: `https://api.imd.fun/artifacts/${HASH}`, bytes: 7 });
    expect(result.files[1]).toMatchObject({ url: null, bytes: null });
    expect(result.files[2]).toMatchObject({ hash: null, url: null });
    expect(() => normalizeJob({ jobId: 'bad', files: [] }, JOB)).toThrow();
  });
});

describe('bounded reads, caching and server errors', () => {
  it('reuses successful readings, deduplicates concurrent calls and refreshes expired results', async () => {
    let time = Date.parse('2026-10-04T00:00:00Z');
    const fetchImpl = vi.fn(async () => json({ pairs: [marketPair()] }));
    const read = createDataReader({ fetchImpl, now: () => time });
    const request = parseQuery('/api/data?kind=market');
    const [first, second] = await Promise.all([read(request), read(request)]);
    expect(first).toEqual(second);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await read(request);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    time += 30_001;
    await read(request);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]).toBeDefined();
  });
  it('separates query caches and bounds retained entries', async () => {
    const fetchImpl = vi.fn(async (source: string | URL | Request) => {
      const id = new URL(String(source)).pathname.split('/').at(-1);
      return json({ tokenId: id, work: [] });
    });
    const read = createDataReader({ fetchImpl, maxEntries: 2 });
    for (const id of ['0', '1', '2', '0']) await read(parseQuery(`/api/data?kind=seat&id=${id}`));
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
  it('fetches the documented bare worker endpoint once with the fixed public swarm GET', async () => {
    const fetchImpl = vi.fn(async (source: string | URL | Request, options?: RequestInit) => {
      expect(options).toMatchObject({ method: 'GET', redirect: 'error', headers: { Accept: 'application/json' } });
      return String(source).includes('/workers') ? json({ workers: [] }) : json({ health: {} });
    });
    const read = createDataReader({ fetchImpl });
    await read(parseQuery('/api/data?kind=swarm'));
    expect(fetchImpl.mock.calls.map(([source]) => source)).toEqual([
      'https://api.imd.fun/swarm', 'https://api.imd.fun/workers',
    ]);
  });
  it('requires a successful valid worker reading before returning the combined swarm', async () => {
    for (const workerResponse of [json({ error: 'busy' }, 503), json({ workers: null }), json({ records: [] })]) {
      const fetchImpl = vi.fn(async (source: string | URL | Request) => String(source) === 'https://api.imd.fun/workers'
        ? workerResponse : json({ health: { agentsOnline: 2, workingNow: 1, acceptedLastDay: 8, seatsEnrolled: 3 } }));
      await expect(createDataReader({ fetchImpl })(parseQuery('/api/data?kind=swarm')))
        .rejects.toMatchObject({ status: 503, code: 'source_unavailable' });
      expect(fetchImpl.mock.calls.map(([source]) => source)).toEqual(['https://api.imd.fun/swarm', 'https://api.imd.fun/workers']);
    }
  });
  it('never caches source failures and preserves missing record status', async () => {
    const fetchImpl = vi.fn(async () => json({ error: 'unknown_seat' }, 404));
    const read = createDataReader({ fetchImpl });
    const request = parseQuery('/api/data?kind=seat&id=42');
    await expect(read(request)).rejects.toMatchObject({ status: 404, code: 'not_found' });
    await expect(read(request)).rejects.toMatchObject({ status: 404 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('rejects HTTP failures, source error bodies, non-JSON and oversized responses', async () => {
    const request = parseQuery('/api/data?kind=market');
    for (const response of [json({}, 429), json({ error: 'too_many_reads' }),
      new Response('<html>error</html>', { headers: { 'Content-Type': 'text/html' } }),
      new Response('invalid', { headers: { 'Content-Type': 'application/json' } })]) {
      await expect(createDataReader({ fetchImpl: async () => response })(request)).rejects.toMatchObject({ status: 503 });
    }
    await expect(createDataReader({ maxBytes: 10, fetchImpl: async () => json({ pairs: [marketPair()] }) })(request))
      .rejects.toMatchObject({ status: 503 });
  });
  it('ends a stuck provider within the finite deadline even if it ignores abort', async () => {
    const read = createDataReader({ timeoutMs: 20, fetchImpl: () => new Promise<Response>(() => {}) });
    await expect(read(parseQuery('/api/data?kind=market'))).rejects.toMatchObject({ status: 503 });
  });
  it('rejects writes and invalid input before calling the source', async () => {
    const read = vi.fn();
    const handler = createDataHandler(read);
    const write = responseRecorder();
    await handler({ method: 'POST', url: '/api/data?kind=market' }, write);
    expect(write.statusCode).toBe(405);
    expect(write.headers.Allow).toBe('GET');
    const bad = responseRecorder();
    await handler({ method: 'GET', url: '/api/data?kind=market&url=anything' }, bad);
    expect(bad.statusCode).toBe(400);
    expect(bad.headers['Cache-Control']).toBe('no-store');
    expect(read).not.toHaveBeenCalled();
  });
  it('sends the source envelope and caches only successful output', async () => {
    const envelope = { kind: 'market', source: 'https://api.dexscreener.com/', fetchedAt: '2026-10-04T00:00:00Z', data: { pairs: [] } };
    const handler = createDataHandler(async () => envelope);
    const result = responseRecorder();
    await handler({ method: 'GET', url: '/api/data?kind=market' }, result);
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual(envelope);
    expect(result.headers['Cache-Control']).toBe('public, s-maxage=20');
  });
});
