import { describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import { createRequestsHandler, parseRequestQuery, validateResearchInput } from '../api/requests.mjs';

const ORIGIN = 'https://voxen.example';
const ORDER = 'a73186c7-c3d4-41b2-9d32-54a3e41e7891';
const IMD_ADDRESS = '0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7';
const TOKEN = 'd'.repeat(64);
const AUTH = `Bearer ${TOKEN}`;
const SIGNATURE = `0x${'e'.repeat(130)}`;
const PAYMENT = Buffer.from(JSON.stringify({ x402Version: 2, payload: { signature: SIGNATURE } })).toString('base64');
const input = () => ({ objective: 'Research the provenance of public IMD market and publication records.', skill: 'research-report',
  outputs: [{ name: 'report', path: 'artifacts/report.md', mediaType: 'text/markdown' }], minCitations: 5, github: false });
const order = (overrides: Record<string, unknown> = {}) => ({ status: 'quoted', order: { id: ORDER, inputJson: JSON.stringify(input()),
  quote: { id: ORDER, action: 'job.open', payment: { network: 'eip155:1', asset: '0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7',
    amount: '500000000000000000', payTo: `0x${'a'.repeat(40)}`, decimals: 18 } }, ...overrides }, payment: null, admission: null });
const json = (payload: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(payload), {
  status, headers: { 'Content-Type': 'application/json', ...headers },
});
const response = () => ({ statusCode: 0, headers: {} as Record<string, string>, body: '',
  setHeader(name: string, value: string) { this.headers[name] = value; }, end(body: string) { this.body = body; } });
const request = (op: string, body?: unknown, extraHeaders: Record<string, string> = {}) => ({
  url: `/api/requests?op=${op}${['order', 'job', 'challenge', 'submit'].includes(op) ? `&id=${ORDER}` : ''}`,
  method: ['capabilities', 'order', 'job'].includes(op) ? 'GET' : 'POST',
  headers: { host: 'voxen.example', origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json',
    ...(['order', 'quote', 'challenge', 'submit'].includes(op) ? { authorization: AUTH } : {}), ...extraHeaders }, body,
});

describe('IMD report gateway boundaries', () => {
  it('maps only approved routes and rejects duplicate, extra and traversal inputs', () => {
    expect(parseRequestQuery(`/api/requests?op=job&id=${ORDER}`).source).toBe(`https://api.imd.fun/jobs/${ORDER}/result`);
    expect(parseRequestQuery(`/api/requests?op=challenge&id=${ORDER}`).source).toBe(`https://api.imd.fun/requests/${ORDER}/submit`);
    for (const url of ['/api/requests?op=unknown', '/api/requests?op=check&op=quote',
      '/api/requests?op=capabilities&url=https://evil.invalid', '/api/requests?op=quote&id=' + ORDER,
      '/api/requests?op=job&id=../../health', '/api/requests?op=job&id=' + ORDER + '&id=' + ORDER,
      'https://evil.invalid/?op=capabilities', '//evil.invalid/?op=capabilities', '/api/requests?op=capabilities&' + 'x'.repeat(2050)]) {
      expect(() => parseRequestQuery(url)).toThrow();
    }
  });
  it('accepts a bounded report and refuses arbitrary actions, outputs and publishing options', () => {
    expect(validateResearchInput(input())).toEqual(input());
    expect(validateResearchInput({ ...input(), objective: 'x'.repeat(8000) }).objective.length).toBe(8000);
    for (const change of [{ objective: '' }, { objective: ' ' }, { objective: 'x'.repeat(8001) }, { objective: 'a\0b' },
      { skill: 'build-website' }, { minCitations: 0 }, { github: true }, { onchain: true }, { contracts: [] }, { outputs: [] },
      { outputs: [{ name: 'report', path: '../report.md', mediaType: 'text/markdown' }] },
      { outputs: [{ ...input().outputs[0], arbitrary: true }] }]) {
      expect(() => validateResearchInput({ ...input(), ...change })).toThrow();
    }
  });
  it('rejects cross-origin and missing-origin browser POSTs before contacting upstream', async () => {
    const fetchImpl = vi.fn(); const handler = createRequestsHandler({ fetchImpl });
    const invalidOrigins: Record<string, string>[] = [{ origin: 'https://evil.invalid' }, { origin: 'null' }, { origin: ORIGIN, 'sec-fetch-site': 'cross-site' },
      { origin: `${ORIGIN}/` }, { origin: 'http://voxen.example' }];
    for (const headers of invalidOrigins) {
      const res = response(); await handler(request('check', { action: 'job.open', input: input() }, headers), res);
      expect(res.statusCode).toBe(403);
    }
    const req = request('quote', { action: 'job.open', input: input(), requestKey: ORDER });
    delete (req.headers as Record<string, string>).origin;
    const res = response(); await handler(req, res); expect(res.statusCode).toBe(403); expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('permits an unauthenticated local input check without weakening paid origin requirements', async () => {
    const fetchImpl = vi.fn(async () => json({ action: 'job.open', blockers: [], suggestions: [] }));
    const handler = createRequestsHandler({ fetchImpl }); const req = request('check', { action: 'job.open', input: input() });
    req.headers = { host: '127.0.0.1:5196', 'content-type': 'application/json' } as typeof req.headers;
    const res = response(); await handler(req, res); expect(res.statusCode).toBe(200); expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it('requires the exact operation method, token syntax and submission header', async () => {
    const fetchImpl = vi.fn(); const handler = createRequestsHandler({ fetchImpl });
    const wrong = request('capabilities'); wrong.method = 'POST'; const res = response(); await handler(wrong, res);
    expect(res.statusCode).toBe(405); expect(res.headers.Allow).toBe('GET');
    for (const authorization of ['', 'Bearer short', `Bearer 0x${TOKEN}`, `Bearer ${TOKEN}\r\nInjected: yes`]) {
      const result = response(); await handler(request('quote', { action: 'job.open', input: input(), requestKey: ORDER }, { authorization }), result);
      expect([400, 401]).toContain(result.statusCode);
    }
    const submit = response(); await handler(request('submit', { quoteSignature: SIGNATURE }), submit);
    expect(submit.statusCode).toBe(400); expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('forwards public capabilities without browser cookies, origin or credentials and never caches responses', async () => {
    const payload = { actions: [], payment: { scheme: 'exact' } };
    const fetchImpl = vi.fn<typeof fetch>(async () => json(payload)); const handler = createRequestsHandler({ fetchImpl });
    for (let run = 0; run < 2; run++) {
      const res = response(); await handler(request('capabilities', undefined, { authorization: AUTH, cookie: 'private=value' }), res);
      expect(JSON.parse(res.body)).toEqual(payload); expect(res.headers['Cache-Control']).toBe('no-store');
      expect(res.headers['Vercel-CDN-Cache-Control']).toBe('no-store');
    }
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: 'GET', redirect: 'error', headers: { Accept: 'application/json' } });
    const headers = new Headers(fetchImpl.mock.calls[0][1]?.headers);
    expect(headers.get('Authorization')).toBeNull();
    expect(headers.get('Origin')).toBeNull();
    expect(headers.get('Cookie')).toBeNull();
  });
  it('forwards a quote once with its client-generated token and exact body', async () => {
    const payload = { created: true, order: order().order }; const fetchImpl = vi.fn<typeof fetch>(async () => json(payload, 201));
    const body = { action: 'job.open', input: input(), requestKey: ORDER }; const res = response();
    await createRequestsHandler({ fetchImpl })(request('quote', body), res);
    expect(res.statusCode).toBe(201); expect(JSON.parse(res.body)).toEqual(payload); expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.imd.fun/requests/quote');
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual(body);
    expect(new Headers(fetchImpl.mock.calls[0][1]?.headers).get('Authorization')).toBe(AUTH);
  });
  it('checks order scope before a challenge, preserving the unsigned 402 and header', async () => {
    const challenge = { x402Version: 2, resource: {}, accepts: [], quote: order().order.quote, requesterScopeHash: 'f'.repeat(64),
      resourceUrl: `https://api.imd.fun/requests/${ORDER}/submit`, input: input() };
    const required = Buffer.from(JSON.stringify(challenge)).toString('base64');
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(order())).mockResolvedValueOnce(json(challenge, 402, { 'PAYMENT-REQUIRED': required }));
    const res = response(); await createRequestsHandler({ fetchImpl })(request('challenge'), res);
    expect(res.statusCode).toBe(402); expect(JSON.parse(res.body)).toEqual(challenge); expect(res.headers['PAYMENT-REQUIRED']).toBe(required);
    const forwarded = fetchImpl.mock.calls[1][1]; expect(forwarded.method).toBe('POST'); expect(forwarded).not.toHaveProperty('body');
    expect(forwarded.headers).not.toHaveProperty('PAYMENT-SIGNATURE');
  });
  it('accepts only the observed empty-contract upstream normalization without modifying it', async () => {
    const prepared = { ...input(), contracts: [] };
    const normalized = order({ inputJson: JSON.stringify(prepared) });
    const challenge = { x402Version: 2, quote: normalized.order.quote, input: prepared };
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(normalized)).mockResolvedValueOnce(json(challenge, 402));
    const res = response(); await createRequestsHandler({ fetchImpl })(request('challenge'), res);
    expect(res.statusCode).toBe(402); expect(JSON.parse(res.body)).toEqual(challenge);
    const reader = vi.fn(async () => json(normalized)); const recovered = response();
    await createRequestsHandler({ fetchImpl: reader })(request('order'), recovered);
    expect(recovered.statusCode).toBe(200); expect(JSON.parse(recovered.body)).toEqual(normalized);
  });
  it('rejects contract targets and additional fields in prepared orders and challenges', async () => {
    for (const change of [{ contracts: [IMD_ADDRESS] }, { contracts: null }, { contracts: {} }, { contracts: [], onchain: true }]) {
      const prepared = { ...input(), ...change };
      const fetchOrder = vi.fn(async () => json(order({ inputJson: JSON.stringify(prepared) })));
      const result = response(); await createRequestsHandler({ fetchImpl: fetchOrder })(request('submit', { quoteSignature: SIGNATURE }, { 'payment-signature': PAYMENT }), result);
      expect(result.statusCode).toBe(400); expect(fetchOrder).toHaveBeenCalledOnce();
      const fetchChallenge = vi.fn().mockResolvedValueOnce(json(order())).mockResolvedValueOnce(json({ x402Version: 2, quote: order().order.quote, input: prepared }, 402));
      const challenge = response(); await createRequestsHandler({ fetchImpl: fetchChallenge })(request('challenge'), challenge);
      expect(challenge.statusCode).toBe(400);
    }
  });
  it('submits the exact signed bytes once and preserves pending status without inventing completion', async () => {
    const pending = { status: 'payment_pending', order: order().order, payment: { status: 'pending' }, admission: null };
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(order())).mockResolvedValueOnce(json(pending, 202, { 'PAYMENT-RESPONSE': 'e30=' }));
    const res = response(); await createRequestsHandler({ fetchImpl })(request('submit', { quoteSignature: SIGNATURE }, { 'payment-signature': PAYMENT }), res);
    expect(res.statusCode).toBe(202); expect(JSON.parse(res.body)).toEqual(pending); expect(res.headers['PAYMENT-RESPONSE']).toBe('e30=');
    expect(fetchImpl).toHaveBeenCalledTimes(2); expect(fetchImpl.mock.calls[1][1].headers['PAYMENT-SIGNATURE']).toBe(PAYMENT);
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({ quoteSignature: SIGNATURE });
  });
  it('rejects an unsigned challenge that changes the report scope or payment asset', async () => {
    for (const change of [{ input: { ...input(), onchain: true } }, { quote: { ...order().order.quote, action: 'launch.open' } },
      { quote: { ...order().order.quote, payment: { ...order().order.quote.payment, asset: `0x${'b'.repeat(40)}` } } }]) {
      const challenge = { x402Version: 2, quote: order().order.quote, input: input(), ...change };
      const fetchImpl = vi.fn().mockResolvedValueOnce(json(order())).mockResolvedValueOnce(json(challenge, 402));
      const res = response(); await createRequestsHandler({ fetchImpl })(request('challenge'), res);
      expect(res.statusCode).toBe(400); expect(JSON.parse(res.body).error).toBe('unsupported_order');
    }
  });
  it('refuses unsupported existing orders and does not forward any payment for them', async () => {
    for (const change of [{ quote: { ...order().order.quote, action: 'launch.open' } },
      { inputJson: JSON.stringify({ ...input(), github: true }) },
      { quote: { ...order().order.quote, payment: { ...order().order.quote.payment, network: 'eip155:11155111' } } },
      { id: 'b73186c7-c3d4-41b2-9d32-54a3e41e7891' }]) {
      const fetchImpl = vi.fn(async () => json(order(change))); const res = response();
      await createRequestsHandler({ fetchImpl })(request('submit', { quoteSignature: SIGNATURE }, { 'payment-signature': PAYMENT }), res);
      expect(res.statusCode).toBe(400); expect(JSON.parse(res.body).error).toBe('unsupported_order'); expect(fetchImpl).toHaveBeenCalledOnce();
    }
  });
  it('preserves an order-preflight failure and never sends the signed submission after it', async () => {
    const error = { error: 'request_limit', detail: 'Try later.' }; const fetchImpl = vi.fn(async () => json(error, 429, { 'Retry-After': '60' }));
    const res = response(); await createRequestsHandler({ fetchImpl })(request('submit', { quoteSignature: SIGNATURE }, { 'payment-signature': PAYMENT }), res);
    expect(res.statusCode).toBe(429); expect(JSON.parse(res.body)).toEqual(error); expect(res.headers['Retry-After']).toBe('60');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it('preserves semantic unavailability and payment rejection rather than submitting or inventing a challenge', async () => {
    const unavailable = { status: 'unavailable', detail: 'Provider unavailable.' };
    const first = vi.fn(async () => json(unavailable)); const status = response();
    await createRequestsHandler({ fetchImpl: first })(request('submit', { quoteSignature: SIGNATURE }, { 'payment-signature': PAYMENT }), status);
    expect(status.statusCode).toBe(200); expect(JSON.parse(status.body)).toEqual(unavailable); expect(first).toHaveBeenCalledOnce();
    const rejected = { error: 'payment_rejected', reason: 'insufficient_funds' };
    const second = vi.fn().mockResolvedValueOnce(json(order())).mockResolvedValueOnce(json(rejected, 402)); const challenge = response();
    await createRequestsHandler({ fetchImpl: second })(request('challenge'), challenge);
    expect(challenge.statusCode).toBe(402); expect(JSON.parse(challenge.body)).toEqual(rejected);
  });
  it('reads order and job result via their fixed routes without retaining tokens', async () => {
    const result = { jobId: ORDER, state: 'working', complete: false, files: [] };
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(order())).mockResolvedValueOnce(json(result)); const handler = createRequestsHandler({ fetchImpl });
    const orderRes = response(); await handler(request('order'), orderRes); expect(JSON.parse(orderRes.body)).toEqual(order());
    const jobRes = response(); await handler(request('job', undefined, { authorization: AUTH }), jobRes); expect(JSON.parse(jobRes.body)).toEqual(result);
    expect(fetchImpl.mock.calls[1][0]).toBe(`https://api.imd.fun/jobs/${ORDER}/result`);
    expect(fetchImpl.mock.calls[1][1].headers).not.toHaveProperty('Authorization');
  });
  it('rejects excess body fields, malformed JSON and oversized request bytes before reading upstream', async () => {
    const fetchImpl = vi.fn(); const handler = createRequestsHandler({ fetchImpl });
    for (const req of [request('check', { action: 'oracle.request', input: input() }),
      request('quote', { action: 'job.open', input: input(), requestKey: 'bad' }),
      request('quote', { action: 'job.open', input: input(), requestKey: ORDER, recipient: 'other' }),
      request('check', '{not-json'), request('check', 'x'.repeat(16 * 1024 + 1)),
      request('challenge', { quoteSignature: SIGNATURE }), request('submit', { quoteSignature: SIGNATURE, unknown: 1 }, { 'payment-signature': PAYMENT }),
      request('check', { action: 'job.open', input: input() }, { 'content-length': '16385' })]) {
      const res = response(); await handler(req, res); expect([400, 413]).toContain(res.statusCode);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('applies request byte limits to streamed bodies and refuses non-JSON content', async () => {
    const fetchImpl = vi.fn(); const handler = createRequestsHandler({ fetchImpl });
    const stream = Object.assign(Readable.from([Buffer.alloc(9000), Buffer.alloc(9000)]), request('check'));
    const res = response(); await handler(stream, res); expect(res.statusCode).toBe(413);
    const plain = response(); await handler(request('check', JSON.stringify({ action: 'job.open', input: input() }), { 'content-type': 'text/plain' }), plain);
    expect(plain.statusCode).toBe(415); expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('bounds payment headers and quote approvals before contacting upstream', async () => {
    const fetchImpl = vi.fn(); const handler = createRequestsHandler({ fetchImpl });
    for (const payment of ['not-base64', 'a'.repeat(12_292), Buffer.from('not-json').toString('base64'), Buffer.from('[]').toString('base64')]) {
      const res = response(); await handler(request('submit', { quoteSignature: SIGNATURE }, { 'payment-signature': payment }), res); expect(res.statusCode).toBe(400);
    }
    for (const signature of ['0x123', SIGNATURE + '0', 'e'.repeat(130)]) {
      const res = response(); await handler(request('submit', { quoteSignature: signature }, { 'payment-signature': PAYMENT }), res); expect(res.statusCode).toBe(400);
    }
    const stray = response(); await handler(request('quote', { action: 'job.open', input: input(), requestKey: ORDER }, { 'payment-signature': PAYMENT }), stray);
    expect(stray.statusCode).toBe(400); expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('rejects invalid JSON, non-JSON content, response-size overflows and redirects', async () => {
    for (const upstream of [new Response('<html/>', { headers: { 'Content-Type': 'text/html' } }),
      new Response('{bad', { headers: { 'Content-Type': 'application/json' } }), json([]),
      json({ value: 'a'.repeat(200) }, 200, { 'Content-Length': '10000' }), json({ value: 'a'.repeat(200) }),
      new Response('{}', { status: 302, headers: { 'Content-Type': 'application/json', Location: 'https://evil.invalid' } })]) {
      const fetchImpl = vi.fn(async () => upstream); const res = response();
      await createRequestsHandler({ fetchImpl, maxBytes: 128 })(request('capabilities'), res);
      expect(res.statusCode).toBe(503); expect(JSON.parse(res.body).error).toBe('source_unavailable'); expect(fetchImpl).toHaveBeenCalledOnce();
    }
  });
  it('does not expose internal exception details or signed credentials in error responses', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error(`Internal secret ${AUTH} ${PAYMENT}`); }); const res = response();
    await createRequestsHandler({ fetchImpl })(request('quote', { action: 'job.open', input: input(), requestKey: ORDER }), res);
    expect(res.statusCode).toBe(503); expect(res.body).not.toContain(TOKEN); expect(res.body).not.toContain(PAYMENT); expect(res.body).not.toContain('Internal secret');
  });
  it('times out without retrying or sending a late paid submission', async () => {
    let release: (value: Response) => void = () => {}; const held = new Promise<Response>(resolve => { release = resolve; });
    const fetchImpl = vi.fn(() => held); const res = response();
    await createRequestsHandler({ fetchImpl, timeoutMs: 5 })(request('submit', { quoteSignature: SIGNATURE }, { 'payment-signature': PAYMENT }), res);
    expect(res.statusCode).toBe(503); release(json(order())); await new Promise(resolve => setTimeout(resolve, 10));
    expect(fetchImpl).toHaveBeenCalledOnce(); expect(res.statusCode).toBe(503);
  });
});
