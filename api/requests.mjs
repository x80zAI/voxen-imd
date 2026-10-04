const API_ORIGIN = 'https://api.imd.fun';
const IMD_ADDRESS = '0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7';
const UUID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;
const AUTH = /^Bearer ([0-9a-f]{64})$/i;
const QUOTE_SIGNATURE = /^0x[0-9a-f]{130}$/i;
const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_PAYMENT_HEADER = 12_288;
const TIMEOUT_MS = 9_000;
const OPERATIONS = new Map([
  ['capabilities', { method: 'GET', path: '/requests/capabilities' }],
  ['check', { method: 'POST', path: '/requests/check' }],
  ['quote', { method: 'POST', path: '/requests/quote', authenticated: true }],
  ['challenge', { method: 'POST', id: true, authenticated: true }],
  ['submit', { method: 'POST', id: true, authenticated: true }],
  ['order', { method: 'GET', id: true, authenticated: true }],
  ['job', { method: 'GET', id: true }],
]);

class RequestError extends Error {
  constructor(status, code, detail) {
    super(detail);
    this.status = status;
    this.code = code;
  }
}
const invalid = (detail = 'This request is not valid.') => new RequestError(400, 'invalid_request', detail);
const unavailable = () => new RequestError(503, 'source_unavailable', 'The IMD service could not be read. Inspect an existing order before retrying a submission.');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exactKeys = (value, keys) => object(value) && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));
const idValue = value => typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null;

function header(req, name) {
  const value = req.headers?.[name.toLowerCase()];
  if (value === undefined) return null;
  if (typeof value !== 'string' || /[\r\n\0]/.test(value)) throw invalid('A request header is not valid.');
  return value;
}

export function parseRequestQuery(requestUrl) {
  if (typeof requestUrl !== 'string' || requestUrl.length > 2048 || !requestUrl.startsWith('/') || requestUrl.startsWith('//')) throw invalid();
  const query = new URL(requestUrl, 'https://gateway.invalid').searchParams;
  const op = query.get('op');
  const operation = OPERATIONS.get(op);
  if (!operation) throw invalid('Choose a supported IMD request operation.');
  const allowed = new Set(operation.id ? ['op', 'id'] : ['op']);
  for (const key of query.keys()) {
    if (!allowed.has(key) || query.getAll(key).length !== 1) throw invalid();
  }
  const id = operation.id ? idValue(query.get('id')) : null;
  if (operation.id && !id) throw invalid('Enter a complete order or job ID in UUID format.');
  const path = operation.path ?? (op === 'job' ? `/jobs/${id}/result`
    : op === 'order' ? `/requests/${id}` : `/requests/${id}/submit`);
  return { op, id, method: operation.method, authenticated: operation.authenticated === true, source: `${API_ORIGIN}${path}` };
}

/** This gateway opens one sourced report, never a contract, launch, schedule or hosted site. */
export function validateResearchInput(input) {
  if (!exactKeys(input, ['objective', 'skill', 'outputs', 'minCitations', 'github'])
    || typeof input.objective !== 'string' || !input.objective.trim() || input.objective.length > 8000
    || [...input.objective].some(character => { const code = character.charCodeAt(0); return (code < 32 && ![9, 10, 13].includes(code)) || code === 127; })
    || input.skill !== 'research-report' || input.minCitations !== 5 || input.github !== false
    || !Array.isArray(input.outputs) || input.outputs.length !== 1
    || !exactKeys(input.outputs[0], ['name', 'path', 'mediaType'])
    || input.outputs[0].name !== 'report' || input.outputs[0].path !== 'artifacts/report.md'
    || input.outputs[0].mediaType !== 'text/markdown') {
    throw invalid('Request a sourced research report with an objective of 1 to 8,000 characters and the required report output.');
  }
  return input;
}

function validatePreparedResearchInput(input) {
  if (!object(input) || !Object.hasOwn(input, 'contracts')) return validateResearchInput(input);
  // IMD normalizes report orders with this empty field. It must never authorize a contract.
  if (!Array.isArray(input.contracts) || input.contracts.length !== 0) throw invalid();
  validateResearchInput(Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'contracts')));
  return input;
}

function requireOrigin(req, op) {
  const origin = header(req, 'origin');
  const host = header(req, 'host');
  const site = header(req, 'sec-fetch-site');
  const local = typeof host === 'string' && /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(host);
  // A local command can inspect input without acquiring a quote or submitting work.
  if (!origin && op === 'check' && local && !site) return;
  if (!origin || !host || host.length > 255 || (site && site !== 'same-origin')) {
    throw new RequestError(403, 'origin_not_allowed', 'Use this action from the VOXEN IMD page on the same origin.');
  }
  const forwarded = header(req, 'x-forwarded-proto');
  const protocol = forwarded === 'https' || forwarded === 'http' ? forwarded : req.socket?.encrypted ? 'https' : local ? 'http' : 'https';
  try {
    const expected = new URL(`${protocol}://${host}`);
    const actual = new URL(origin);
    if (actual.origin !== origin || actual.origin !== expected.origin || actual.username || actual.password
      || (!local && actual.protocol !== 'https:')) throw invalid();
  } catch {
    throw new RequestError(403, 'origin_not_allowed', 'Use this action from the VOXEN IMD page on the same origin.');
  }
}

function bearer(req) {
  const value = header(req, 'authorization');
  if (!value || !AUTH.test(value)) {
    throw new RequestError(401, 'request_token_required', 'A client-generated 32-byte request token is required.');
  }
  return value;
}

function paymentSignature(req) {
  const value = header(req, 'payment-signature');
  if (!value || value.length > MAX_PAYMENT_HEADER || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
    || value.length % 4 !== 0) throw invalid('The payment signature header is not valid.');
  try {
    const bytes = Buffer.from(value, 'base64');
    if (bytes.toString('base64') !== value || !object(JSON.parse(bytes.toString('utf8')))) throw invalid();
  } catch { throw invalid('The payment signature header is not valid.'); }
  return value;
}

async function readBody(req) {
  const length = header(req, 'content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_REQUEST_BYTES)) {
    throw new RequestError(413, 'body_too_large', 'Keep the request body within 16 KiB.');
  }
  const encoding = header(req, 'content-encoding');
  if (encoding && encoding !== 'identity') throw new RequestError(415, 'unsupported_media_type', 'Send an uncompressed JSON request.');
  let raw;
  if (req.body !== undefined && req.body !== null) {
    try { raw = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body); }
    catch { throw invalid('The request body is not readable JSON.'); }
  } else if (typeof req[Symbol.asyncIterator] === 'function') {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > MAX_REQUEST_BYTES) throw new RequestError(413, 'body_too_large', 'Keep the request body within 16 KiB.');
      chunks.push(bytes);
    }
    raw = Buffer.concat(chunks).toString('utf8');
  } else raw = '';
  if (Buffer.byteLength(raw ?? '', 'utf8') > MAX_REQUEST_BYTES) throw new RequestError(413, 'body_too_large', 'Keep the request body within 16 KiB.');
  if (!raw) return undefined;
  if (!/^application\/json(?:\s*;|$)/i.test(header(req, 'content-type') ?? '')) {
    throw new RequestError(415, 'unsupported_media_type', 'Send the request as application/json.');
  }
  try { return JSON.parse(raw); } catch { throw invalid('The request body is not readable JSON.'); }
}

function requestBody(op, body) {
  if (op === 'challenge') {
    if (body !== undefined && !exactKeys(body, [])) throw invalid('The payment challenge does not take an input body.');
    return undefined;
  }
  if (op === 'submit') {
    if (!exactKeys(body, ['quoteSignature']) || typeof body.quoteSignature !== 'string'
      || !QUOTE_SIGNATURE.test(body.quoteSignature)) throw invalid('The exact signed quote approval is required.');
    return body;
  }
  if (!exactKeys(body, op === 'quote' ? ['action', 'input', 'requestKey'] : ['action', 'input'])
    || body.action !== 'job.open') throw invalid('Only a sourced research-report job can be opened here.');
  validateResearchInput(body.input);
  if (op === 'quote' && !idValue(body.requestKey)) throw invalid('Generate a UUID request key for this quote.');
  return body;
}

function assertResearchQuote(quote, input, id) {
  if (!object(quote) || idValue(quote.id) !== id || quote.action !== 'job.open') {
    throw new RequestError(400, 'unsupported_order', 'This gateway can submit only a sourced research-report order.');
  }
  try { validatePreparedResearchInput(input); }
  catch { throw new RequestError(400, 'unsupported_order', 'This gateway can submit only a sourced research-report order.'); }
  const payment = quote.payment;
  if (!object(payment) || payment.network !== 'eip155:1'
    || typeof payment.asset !== 'string' || payment.asset.toLowerCase() !== IMD_ADDRESS
    || payment.decimals !== 18 || typeof payment.amount !== 'string' || !/^[1-9]\d{0,77}$/.test(payment.amount)
    || typeof payment.payTo !== 'string' || !/^0x[0-9a-f]{40}$/i.test(payment.payTo)
    || /^0x0{40}$/i.test(payment.payTo)) {
    throw new RequestError(400, 'unsupported_order', 'The report order must use the official IMD token on Ethereum.');
  }
}

function assertReportOrder(payload, id) {
  if (!object(payload) || !object(payload.order) || idValue(payload.order.id) !== id
    || typeof payload.order.inputJson !== 'string') {
    throw new RequestError(400, 'unsupported_order', 'This gateway can submit only a sourced research-report order.');
  }
  let input;
  try { input = JSON.parse(payload.order.inputJson); }
  catch { throw new RequestError(400, 'unsupported_order', 'This gateway can submit only a sourced research-report order.'); }
  assertResearchQuote(payload.order.quote, input, id);
}

async function readUpstream(fetchImpl, source, options, signal, maxBytes) {
  if (signal.aborted) throw unavailable();
  const response = await fetchImpl(source, { ...options, redirect: 'error', signal });
  if (signal.aborted || response.redirected || response.status < 200 || response.status >= 600
    || (response.status >= 300 && response.status < 400)
    || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') || !response.body) throw unavailable();
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw unavailable();
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let raw = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (signal.aborted || size > maxBytes) throw unavailable();
      raw += decoder.decode(chunk.value, { stream: true });
    }
    raw += decoder.decode();
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  if (signal.aborted) throw unavailable();
  let payload;
  try { payload = JSON.parse(raw); } catch { throw unavailable(); }
  if (!object(payload)) throw unavailable();
  const headers = {};
  for (const name of ['PAYMENT-REQUIRED', 'PAYMENT-RESPONSE', 'Retry-After']) {
    const value = response.headers.get(name);
    if (value !== null) {
      if (value.length > (name === 'Retry-After' ? 256 : 16_384) || /[^\x20-\x7e]/.test(value)) throw unavailable();
      headers[name] = value;
    }
  }
  return { status: response.status, payload, headers };
}

/** Credentials and signed payloads pass through once; none are stored, cached or logged. */
export function createRequestsHandler({ fetchImpl = globalThis.fetch, timeoutMs = TIMEOUT_MS, maxBytes = MAX_RESPONSE_BYTES } = {}) {
  return async function requestsHandler(req, res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
    let timer;
    const controller = new AbortController();
    try {
      const request = parseRequestQuery(req.url);
      if (req.method !== request.method) {
        res.setHeader('Allow', request.method);
        throw new RequestError(405, 'method_not_allowed', `Use ${request.method} for this operation.`);
      }
      if (request.method === 'POST') requireOrigin(req, request.op);
      const auth = request.authenticated ? bearer(req) : null;
      const signedPayment = request.op === 'submit' ? paymentSignature(req) : null;
      if (request.op !== 'submit' && header(req, 'payment-signature') !== null) throw invalid('A payment signature belongs only to an explicit submission.');
      const operation = (async () => {
        const body = request.method === 'POST' ? requestBody(request.op, await readBody(req)) : undefined;
        const headers = { Accept: 'application/json', ...(auth ? { Authorization: auth } : {}) };
        if (request.op === 'challenge' || request.op === 'submit' || request.op === 'order') {
          const order = await readUpstream(fetchImpl, `${API_ORIGIN}/requests/${request.id}`, { method: 'GET', headers }, controller.signal, maxBytes);
          if (order.status < 200 || order.status >= 300 || order.payload.error
            || ['blocked', 'unavailable'].includes(order.payload.status)) return order;
          assertReportOrder(order.payload, request.id);
          if (request.op === 'order') return order;
        }
        const result = await readUpstream(fetchImpl, request.source, {
          method: request.method,
          headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(signedPayment ? { 'PAYMENT-SIGNATURE': signedPayment } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }, controller.signal, maxBytes);
        if (request.op === 'challenge' && result.status === 402 && !result.payload.error) {
          assertResearchQuote(result.payload.quote, result.payload.input, request.id);
        }
        return result;
      })();
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(unavailable()); }, timeoutMs);
      });
      const result = await Promise.race([operation, timeout]);
      for (const [name, value] of Object.entries(result.headers)) res.setHeader(name, value);
      res.statusCode = result.status;
      res.end(JSON.stringify(result.payload));
    } catch (error) {
      const failure = error instanceof RequestError ? error : unavailable();
      res.statusCode = failure.status;
      res.end(JSON.stringify({ error: failure.code, detail: failure.message }));
    } finally { clearTimeout(timer); controller.abort(); }
  };
}

export default createRequestsHandler();
