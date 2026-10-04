const IMD_ADDRESS = '0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7';
const API_ORIGIN = 'https://api.imd.fun';
const MARKET_SOURCE = `https://api.dexscreener.com/latest/dex/tokens/${IMD_ADDRESS}`;
const PUBLICATION_TYPES = new Set(['all', 'tokens', 'contracts', 'sites', 'research', 'code', 'media', 'audits']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const CACHE_TTL_MS = 30_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 96;
const TIMEOUT_MS = 9_000;

export class DataError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const invalid = (message = 'This request is not valid.') => new DataError(400, 'invalid_request', message);
const unavailable = () => new DataError(503, 'source_unavailable', 'The original data source is temporarily unavailable. Please try again.');
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, limit = 4000) => typeof value === 'string' && value.trim() ? value.slice(0, limit) : null;
const numeric = (value, allowNegative = false) => {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value))) return null;
  const number = Number(value);
  return Number.isFinite(number) && (allowNegative || number >= 0) ? number : null;
};
const count = (value) => {
  const number = numeric(value);
  return Number.isSafeInteger(number) ? number : null;
};
const date = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
};
const boolean = (value) => typeof value === 'boolean' ? value : null;
const array = (value) => Array.isArray(value) ? value : [];
const uuid = (value) => typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null;
const tokenId = (value) => {
  const number = count(value);
  return number !== null && number <= 1999 ? String(number) : null;
};
function httpsUrl(value, hostname) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || (hostname && url.hostname !== hostname)) return null;
    return url.href;
  } catch { return null; }
}

/** Every route is selected here; input never becomes an upstream hostname or method. */
export function parseQuery(requestUrl) {
  if (typeof requestUrl !== 'string' || requestUrl.length > 2048) throw invalid();
  let query;
  try { query = new URL(requestUrl, 'https://voxen-imd.invalid').searchParams; } catch { throw invalid(); }
  const kind = query.get('kind');
  if (!['market', 'swarm', 'seat', 'publications', 'job'].includes(kind)) throw invalid('Choose a supported data tool.');
  const allowed = new Set(kind === 'seat' || kind === 'job' ? ['kind', 'id']
    : kind === 'publications' ? ['kind', 'q', 'type', 'page'] : ['kind']);
  for (const key of query.keys()) {
    if (!allowed.has(key) || query.getAll(key).length !== 1) throw invalid();
  }
  if (kind === 'seat') {
    const id = query.get('id');
    if (!id || !/^(?:0|[1-9]\d{0,3})$/.test(id) || Number(id) > 1999) {
      throw invalid('Enter an Identity.MD seat number from 0 to 1999.');
    }
    return { kind, id, key: `seat:${id}`, source: `${API_ORIGIN}/seats/${id}?work=20&reviews=0` };
  }
  if (kind === 'job') {
    const id = uuid(query.get('id'));
    if (!id) throw invalid('Enter a complete job ID in UUID format.');
    return { kind, id, key: `job:${id}`, source: `${API_ORIGIN}/jobs/${id}/result` };
  }
  if (kind === 'publications') {
    const q = (query.get('q') ?? '').trim();
    const type = query.get('type') ?? 'all';
    const pageValue = query.get('page') ?? '1';
    if (q.length > 200 || [...q].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
      throw invalid('Use a search of 200 characters or fewer.');
    }
    if (!PUBLICATION_TYPES.has(type) || !/^[1-9]\d{0,3}$/.test(pageValue) || Number(pageValue) > 1000) throw invalid();
    const page = Number(pageValue);
    const params = new URLSearchParams({ q, type, page: String(page), pageSize: '12', sort: 'newest' });
    const source = `${API_ORIGIN}/publications?${params}`;
    return { kind, q, type, page, key: source, source };
  }
  return { kind, key: kind, source: kind === 'market' ? MARKET_SOURCE : `${API_ORIGIN}/swarm` };
}

export function normalizeMarket(payload) {
  if (!object(payload) || !Array.isArray(payload.pairs)) throw unavailable();
  const seen = new Set();
  const pairs = payload.pairs.filter((pair) => object(pair) && pair.chainId === 'ethereum'
    && typeof pair.baseToken?.address === 'string' && pair.baseToken.address.toLowerCase() === IMD_ADDRESS)
    .slice(0, 100).flatMap((pair) => {
      const id = text(pair.pairAddress, 80);
      const url = httpsUrl(pair.url, 'dexscreener.com');
      if (!id || !/^0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(id) || !url || seen.has(id.toLowerCase())) return [];
      seen.add(id.toLowerCase());
      const quote = text(pair.quoteToken?.symbol, 40);
      return [{ id, dex: text(pair.dexId, 40), name: `IMD / ${quote ?? 'Unknown quote'}`, quote,
        priceUsd: numeric(pair.priceUsd), liquidityUsd: numeric(pair.liquidity?.usd),
        volume24h: numeric(pair.volume?.h24), change24h: numeric(pair.priceChange?.h24, true),
        buys24h: count(pair.txns?.h24?.buys), sells24h: count(pair.txns?.h24?.sells), url }];
    });
  pairs.sort((left, right) => (right.liquidityUsd ?? -1) - (left.liquidityUsd ?? -1));
  return { pairs };
}

export function normalizeSwarm(payload, workerPayload) {
  if (!object(payload) || !object(payload.health) || payload.health.reachable === false
    || !object(workerPayload) || !Array.isArray(workerPayload.workers)) throw unavailable();
  const workers = workerPayload.workers.slice(0, 2000).flatMap((worker) => {
    if (!object(worker) || !object(worker.seat)) return [];
    const id = tokenId(worker.seat.tokenId);
    if (id === null) return [];
    const active = numeric(worker.working);
    return [{ tokenId: id, agentId: text(worker.seat.agentId, 80),
      working: typeof worker.working === 'boolean' ? worker.working : active !== null ? active > 0 : null,
      skills: array(worker.skills).filter((skill) => typeof skill === 'string').slice(0, 100).map((skill) => skill.slice(0, 120)),
      lastSeenAt: date(worker.lastHeartbeatAt) }];
  });
  return { online: count(payload.health.agentsOnline), working: count(payload.health.workingNow),
    accepted24h: count(payload.health.acceptedLastDay), seats: count(payload.health.seatsEnrolled), workers };
}

export function normalizeSeat(payload, requestedId) {
  if (!object(payload) || tokenId(payload.tokenId) !== requestedId || !Array.isArray(payload.work)) throw unavailable();
  return { tokenId: requestedId, agentId: text(payload.agentId, 80),
    owner: typeof payload.owner === 'string' && /^0x[0-9a-f]{40}$/i.test(payload.owner) ? payload.owner : null,
    online: boolean(payload.online), attempts: count(payload.attempts), accepted: count(payload.accepted),
    rejected: count(payload.rejected), failed: count(payload.failed), pending: count(payload.pending),
    lastWorkedAt: date(payload.lastWorkedAt), work: payload.work.slice(0, 20).flatMap((work) => {
      if (!object(work) || !uuid(work.jobId)) return [];
      return [{ jobId: uuid(work.jobId), objective: text(work.objective), status: text(work.status, 80), submittedAt: date(work.submittedAt) }];
    }) };
}

function normalizeFiles(files, allowHashUrl = false) {
  return array(files).slice(0, 200).flatMap((file) => {
    if (!object(file)) return [];
    const hash = typeof file.hash === 'string' && HASH.test(file.hash) ? file.hash : null;
    let url = null;
    if (hash) {
      const expected = `${API_ORIGIN}/artifacts/${hash}`;
      if (allowHashUrl || file.url === `/artifacts/${hash}` || file.url === expected) url = expected;
    }
    return [{ name: text(file.name, 256) ?? text(file.path, 256), hash, url,
      bytes: count(file.bytes), mediaType: text(file.mediaType, 120) }];
  });
}

export function normalizePublications(payload, requestedPage) {
  if (!object(payload) || !Array.isArray(payload.items) || count(payload.page) !== requestedPage
    || count(payload.count) === null || count(payload.totalPages) === null) throw unavailable();
  const items = payload.items.slice(0, 12).flatMap((item) => {
    if (!object(item) || !text(item.id, 100) || !text(item.title)) return [];
    const versions = array(item.versions).filter(object);
    const latest = versions.at(-1);
    const records = ['code', 'media', 'sites', 'research', 'audits'].flatMap((key) => array(item[key]).filter(object));
    const byTime = [...records].sort((left, right) => (Date.parse(right.publishedAt ?? right.namedAt ?? right.createdAt) || 0)
      - (Date.parse(left.publishedAt ?? left.namedAt ?? left.createdAt) || 0));
    const record = byTime[0];
    const jobId = uuid(latest?.jobId) ?? uuid(record?.jobId)
      ?? (item.id.startsWith('job:') ? uuid(item.id.slice(4)) : null);
    const namedSite = array(item.sites).find((site) => object(site) && typeof site.label === 'string'
      && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(site.label) && site.status === 'named' && !site.supersededBy);
    const types = array(item.types).filter((type) => PUBLICATION_TYPES.has(type) && type !== 'all');
    const chains = [...new Set(array(item.contracts).filter(object).map((contract) => count(contract.chainId)).filter((chain) => chain !== null))];
    const files = array(item.media).filter(object).flatMap((media) => normalizeFiles(media.files, true)).slice(0, 200);
    return [{ id: text(item.id, 100), jobId, objective: text(item.title), type: types.length ? types.join(' · ') : null,
      state: text(latest?.state, 80) ?? text(item.release?.status, 80),
      deliveredAt: date(latest?.deliveredAt) ?? date(item.publishedAt),
      repoUrl: httpsUrl(latest?.repoUrl, 'github.com') ?? httpsUrl(record?.repoUrl, 'github.com')
        ?? httpsUrl(array(item.contracts).find(object)?.sourceRepoUrl, 'github.com'),
      siteUrl: namedSite ? `https://${namedSite.label}.sites.imd.fun/` : null,
      commit: text(latest?.commit, 80) ?? text(record?.commit, 80)
        ?? text(array(item.contracts).find(object)?.sourceCommit, 80), files, chains }];
  });
  return { count: count(payload.count), totalPages: count(payload.totalPages), page: requestedPage, items };
}

export function normalizeJob(payload, requestedId) {
  if (!object(payload) || uuid(payload.jobId) !== requestedId || !Array.isArray(payload.files)) throw unavailable();
  return { id: requestedId, state: text(payload.state, 80), complete: boolean(payload.complete), files: normalizeFiles(payload.files) };
}

async function readJson(fetchImpl, source, signal, maxBytes) {
  const response = await fetchImpl(source, { method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error', signal });
  if (response.status === 404) throw new DataError(404, 'not_found', 'The original source has no record for this ID.');
  if (!response.ok) throw unavailable();
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) throw unavailable();
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw unavailable();
  if (!response.body) throw unavailable();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) throw unavailable();
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  let payload;
  try { payload = JSON.parse(body); } catch { throw unavailable(); }
  if (!object(payload) || payload.error || payload.status === 'unavailable' || payload.status === 'blocked') throw unavailable();
  return payload;
}

/** Only successful, normalized readings are cached. Different queries never share a result. */
export function createDataReader({ fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = TIMEOUT_MS,
  maxBytes = MAX_RESPONSE_BYTES, maxEntries = MAX_CACHE_ENTRIES } = {}) {
  const cache = new Map();
  const inFlight = new Map();
  return async function readData(request) {
    const cached = cache.get(request.key);
    if (cached && now() >= cached.at && now() - cached.at < CACHE_TTL_MS) return cached.envelope;
    if (inFlight.has(request.key)) return inFlight.get(request.key);
    if (inFlight.size >= maxEntries) throw unavailable();
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(unavailable()); }, timeoutMs);
    });
    const operation = (async () => {
      const workersSource = `${API_ORIGIN}/workers`;
      const [payload, workerPayload] = await Promise.all([
        readJson(fetchImpl, request.source, controller.signal, maxBytes),
        request.kind === 'swarm' ? readJson(fetchImpl, workersSource, controller.signal, maxBytes) : null,
      ]);
      let data;
      if (request.kind === 'market') data = normalizeMarket(payload);
      if (request.kind === 'swarm') data = normalizeSwarm(payload, workerPayload);
      if (request.kind === 'seat') data = normalizeSeat(payload, request.id);
      if (request.kind === 'publications') data = normalizePublications(payload, request.page);
      if (request.kind === 'job') data = normalizeJob(payload, request.id);
      if (!data || controller.signal.aborted) throw unavailable();
      return { kind: request.kind, source: request.source, fetchedAt: new Date(now()).toISOString(), data };
    })();
    const promise = Promise.race([operation, timeout]).then((envelope) => {
      cache.delete(request.key);
      cache.set(request.key, { at: now(), envelope });
      while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
      return envelope;
    }).catch((error) => { throw error instanceof DataError ? error : unavailable(); })
      .finally(() => { clearTimeout(timer); controller.abort(); inFlight.delete(request.key); });
    inFlight.set(request.key, promise);
    return promise;
  };
}

export function createDataHandler(readData = createDataReader()) {
  return async function dataHandler(req, res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      res.statusCode = 405;
      res.end(JSON.stringify({ error: 'method_not_allowed', message: 'Only GET is supported.' }));
      return;
    }
    try {
      const request = parseQuery(req.url);
      const envelope = await readData(request);
      res.setHeader('Cache-Control', 'public, s-maxage=20');
      res.statusCode = 200;
      res.end(JSON.stringify(envelope));
    } catch (error) {
      const failure = error instanceof DataError ? error : unavailable();
      res.statusCode = failure.status;
      res.end(JSON.stringify({ error: failure.code, message: failure.message }));
    }
  };
}

export default createDataHandler();
