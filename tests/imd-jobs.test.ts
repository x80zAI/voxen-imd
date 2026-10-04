import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import type { ClientEvmSigner } from '@x402/evm';
import {
  IMD_RECIPIENT, IMD_TOKEN, PAYMENT_PROXY, buildResearchInput, canonicalHash,
  canonicalJson, checkResearch, loadSavedRequests, readResearchResult, requireCurrentQuote,
  saveRequest, submitSignedPayment, validateCapabilities, validateChallenge, validateOrder,
  validatePermitMessage,
} from '../src/imd-jobs';
import type { JobPolicy, Order, SavedRequest } from '../src/imd-jobs';
import IMDJobs from '../src/IMDJobs';

// Private protocol fixtures: no browser wallet, real order, signature or payment is used.
const NOW = Date.parse('2026-10-04T16:00:00.000Z');
const SECOND = NOW / 1000;
const ORDER_ID = 'a73186c7-c3d4-41b2-9d32-54a3e41e7891';
const KEY = 'acfe937c-8813-459a-b3d5-108d816053c6';
const JOB_ID = 'e4be1f3d-96b6-48e6-835b-aee0760627d8';
const PAYER = `0x${'9'.repeat(40)}` as const;
const SIG = `0x${'a'.repeat(130)}` as const;
const STORAGE_KEY = 'voxen.imd.requests.v1';
const RESOURCE = `https://api.imd.fun/requests/${ORDER_ID}/submit`;
const input = () => buildResearchInput('Research the provenance of the public IMD publication record.');
const payment = () => ({ network: 'eip155:1' as const, asset: IMD_TOKEN, amount: '500000000000000000', payTo: IMD_RECIPIENT, decimals: 18 as const });
const policy = (): JobPolicy => ({ version: 'paid-research-v1', payment: payment(), quoteTtlSeconds: 600, readAt: new Date(NOW).toISOString() });
const requirements = () => ({ scheme: 'exact', network: 'eip155:1' as const, asset: IMD_TOKEN, amount: payment().amount, payTo: IMD_RECIPIENT,
  maxTimeoutSeconds: 300, extra: { assetTransferMethod: 'permit2' } });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
let storage: Map<string, string>;

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(NOW);
  storage = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

async function saved(signed = false): Promise<SavedRequest> {
  const brief = input();
  const order: Order = {
    id: ORDER_ID, requestKey: KEY, status: 'quoted', inputJson: JSON.stringify(brief), createdAt: new Date(NOW).toISOString(), paidAt: null,
    quote: { v: 1, id: ORDER_ID, action: 'job.open', policyVersion: policy().version, inputHash: await canonicalHash(brief),
      issuedAt: SECOND, expiresAt: SECOND + 600, payment: { ...payment(), scheme: 'exact' },
      terms: { purchase: 'action-admission', resultGuaranteed: false }, quoteHash: 'b'.repeat(64) },
  };
  const request: SavedRequest = { v: 1, token: 'c'.repeat(64), requestKey: KEY, input: brief, createdAt: new Date(NOW).toISOString(), order, lastStatus: 'quoted' };
  if (signed) {
    const expiresAt = SECOND + 300;
    const body = { x402Version: 2, resource: { url: RESOURCE, mimeType: 'application/json' }, accepted: requirements(),
      payload: { signature: SIG, permit2Authorization: { from: PAYER, permitted: { token: IMD_TOKEN, amount: payment().amount },
        spender: PAYMENT_PROXY, nonce: '42', deadline: String(expiresAt), witness: { to: IMD_RECIPIENT, validAfter: '0' } } } };
    request.signed = { paymentHeader: Buffer.from(JSON.stringify(body)).toString('base64'), quoteSignature: SIG, expiresAt, payer: PAYER };
  }
  return request;
}
function status(request: SavedRequest, state = 'quoted') {
  return { status: state, order: { ...request.order!, status: state === 'admitted' || state === 'admission_pending' ? 'paid' : state },
    payment: state === 'admitted' ? { paid: true, status: 'confirmed', transactionHash: `0x${'d'.repeat(64)}` } : null,
    admission: state === 'admitted' ? { result: { kind: 'job', jobId: JOB_ID, launch: false, statusUrl: `/jobs/${JOB_ID}`, resultUrl: `/jobs/${JOB_ID}/result` } } : null };
}

describe('Research order and wallet boundaries', () => {
  it('hashes canonical JSON independently of object-key order and refuses unsafe values', async () => {
    expect(canonicalJson({ z: [1, true, null], a: 'IMD' })).toBe('{"a":"IMD","z":[1,true,null]}');
    expect(await canonicalHash({ b: 2, a: 1 })).toBe(await canonicalHash({ a: 1, b: 2 }));
    for (const value of [NaN, Infinity, 1.5, undefined, 1n, new Date(), { a: undefined }]) expect(() => canonicalJson(value)).toThrow();
  });
  it('rejects a policy that changes the chain, token, recipient, cost ceiling or payment scheme', () => {
    const capabilities = { authentication: { scheme: 'Bearer', tokenBytes: 32, encoding: 'hex', creator: 'client' },
      payment: { x402Version: 2, scheme: 'exact', assetTransferMethod: 'permit2', quoteApproval: 'EIP-712' },
      actions: [{ action: 'job.open', version: policy().version, quoteTtlSeconds: 600, payment: payment() }] };
    expect(validateCapabilities(capabilities).payment.amount).toBe(payment().amount);
    for (const change of [{ network: 'eip155:8453' }, { asset: PAYER }, { payTo: PAYER }, { amount: '500000000000000001' }, { amount: '-1' }, { decimals: 6 }]) {
      expect(() => validateCapabilities({ ...capabilities, actions: [{ ...capabilities.actions[0], payment: { ...payment(), ...change } }] })).toThrow();
    }
    expect(() => validateCapabilities({ ...capabilities, payment: { ...capabilities.payment, scheme: 'upto' } })).toThrow();
  });
  it('binds the order to the saved request key, exact brief, restricted output and input digest', async () => {
    const request = await saved();
    expect(await validateOrder(request.order, request)).toEqual(request.order);
    const changes = [
      { requestKey: JOB_ID }, { id: JOB_ID }, { inputJson: JSON.stringify({ ...request.input, objective: 'A changed brief.' }) },
      { inputJson: JSON.stringify({ ...request.input, github: true }) },
      { quote: { ...request.order!.quote, inputHash: 'e'.repeat(64) } },
      { quote: { ...request.order!.quote, action: 'job.clone' } },
      { quote: { ...request.order!.quote, terms: { purchase: 'action-admission', resultGuaranteed: true } } },
    ];
    for (const change of changes) await expect(validateOrder({ ...request.order, ...change }, request)).rejects.toThrow();
  });
  it('accepts the observed empty-contract preparation and hashes its exact prepared bytes', async () => {
    const request = await saved();
    const prepared = { ...request.input, contracts: [] };
    const normalized = { ...request.order!, inputJson: JSON.stringify(prepared), quote: { ...request.order!.quote, inputHash: await canonicalHash(prepared) } };
    await expect(validateOrder(normalized, request)).resolves.toEqual(normalized);
    const recovered = { ...request, order: normalized };
    storage.set(STORAGE_KEY, JSON.stringify([recovered]));
    expect(loadSavedRequests()).toEqual([recovered]);
    const challenge = { x402Version: 2, resource: { url: RESOURCE, mimeType: 'application/json' }, resourceUrl: RESOURCE,
      requesterScopeHash: 'f'.repeat(64), quote: normalized.quote, input: prepared, accepts: [requirements()] };
    await expect(validateChallenge(challenge, recovered, policy(), SECOND)).resolves.toEqual(challenge);
    // Semantic equality alone cannot replace the digest of the normalized inputJson.
    await expect(validateOrder({ ...normalized, quote: request.order!.quote }, request)).rejects.toThrow();
  });
  it('refuses contract targets or unknown fields even when their prepared digest is correct', async () => {
    const request = await saved();
    for (const change of [{ contracts: [IMD_TOKEN] }, { contracts: null }, { contracts: {} }, { contracts: [], arbitrary: true },
      { contracts: [], objective: 'Changed research question.' }, { contracts: [], minCitations: 0 }, { contracts: [], github: true }]) {
      const prepared = { ...request.input, ...change };
      const order = { ...request.order!, inputJson: JSON.stringify(prepared), quote: { ...request.order!.quote, inputHash: await canonicalHash(prepared) } };
      await expect(validateOrder(order, request)).rejects.toThrow();
      storage.set(STORAGE_KEY, JSON.stringify([{ ...request, order }]));
      expect(loadSavedRequests()).toEqual([]);
    }
  });
  it('rejects stale and future quotes and an amount changed after policy review', async () => {
    const quote = (await saved()).order!.quote;
    expect(() => requireCurrentQuote(quote, policy(), SECOND)).not.toThrow();
    for (const change of [{ expiresAt: SECOND + 29 }, { issuedAt: SECOND + 31 }, { payment: { ...quote.payment, amount: '1' } }, { policyVersion: 'different' }]) {
      expect(() => requireCurrentQuote({ ...quote, ...change }, policy(), SECOND)).toThrow();
    }
  });
  it('checks every challenge against the reviewed resource, order, brief and exact payment requirements', async () => {
    const request = await saved();
    const challenge = { x402Version: 2, resource: { url: RESOURCE, mimeType: 'application/json' }, resourceUrl: RESOURCE,
      requesterScopeHash: 'f'.repeat(64), quote: request.order!.quote, input: request.input, accepts: [requirements()] };
    await expect(validateChallenge(challenge, request, policy(), SECOND)).resolves.toEqual(challenge);
    const changes = [
      { resourceUrl: RESOURCE + '?other=1' }, { resource: { url: 'https://evil.invalid/pay' } },
      { quote: { ...challenge.quote, quoteHash: '1'.repeat(64) } }, { input: { ...request.input, objective: 'Another objective.' } },
      { accepts: [{ ...requirements(), amount: '1' }] }, { accepts: [{ ...requirements(), payTo: PAYER }] },
      { accepts: [{ ...requirements(), extra: { assetTransferMethod: 'permit2', arbitrary: true } }] },
      { accepts: [requirements(), requirements()] },
    ];
    for (const change of changes) await expect(validateChallenge({ ...challenge, ...change }, request, policy(), SECOND)).rejects.toThrow();
  });
  it('accepts the installed x402 SDK exact Permit2 message without invoking a browser wallet', async () => {
    const quote = (await saved()).order!.quote;
    let observed: Parameters<ClientEvmSigner['signTypedData']>[0] | null = null;
    const signer: ClientEvmSigner = { address: PAYER, signTypedData: async data => { observed = data; validatePermitMessage(data, quote, SECOND); return SIG; } };
    const generated = await new ExactEvmScheme(signer).createPaymentPayload(2, requirements());
    expect(observed).not.toBeNull();
    expect(generated.payload).toHaveProperty('permit2Authorization.spender', expect.stringMatching(new RegExp(`^${PAYMENT_PROXY}$`, 'i')));
    expect(generated.payload).toHaveProperty('permit2Authorization.permitted.amount', quote.payment.amount);
  });
  it('rejects arbitrary Permit2 token, spender, recipient, amount and signing expiry before signature dispatch', async () => {
    const quote = (await saved()).order!.quote;
    let message: Parameters<ClientEvmSigner['signTypedData']>[0] | undefined;
    await new ExactEvmScheme({ address: PAYER, signTypedData: async data => { message = data; return SIG; } }).createPaymentPayload(2, requirements());
    const valid = message!;
    const changes = [
      { domain: { ...valid.domain, chainId: 8453 } }, { domain: { ...valid.domain, verifyingContract: PAYER } },
      { primaryType: 'TransferWithAuthorization' },
      { message: { ...valid.message, permitted: { token: PAYER, amount: BigInt(payment().amount) } } },
      { message: { ...valid.message, permitted: { token: IMD_TOKEN, amount: 1n } } },
      { message: { ...valid.message, spender: PAYER } }, { message: { ...valid.message, witness: { to: PAYER, validAfter: 0n } } },
      { message: { ...valid.message, deadline: BigInt(quote.expiresAt) } }, { message: { ...valid.message, deadline: BigInt(SECOND + 6) } },
    ];
    for (const change of changes) expect(() => validatePermitMessage({ ...valid, ...change }, quote, SECOND)).toThrow();
  });
});

describe('Saved recovery and retry boundaries', () => {
  it('discards corrupt nested stored quotes before their amounts can reach the page', async () => {
    const record = await saved();
    const corruptions = [
      { order: { id: ORDER_ID } }, { order: { ...record.order, quote: null } },
      { order: { ...record.order, quote: { ...record.order!.quote, payment: { amount: 'invalid' } } } },
      { order: { ...record.order, quote: { ...record.order!.quote, payment: { ...payment(), scheme: 'exact', amount: '-1' } } } },
      { order: { ...record.order, inputJson: '{' } }, { input: { ...record.input, github: true } },
      { lastStatus: '<script>' }, { token: 'not-an-access-token' },
    ];
    for (const change of corruptions) {
      storage.set(STORAGE_KEY, JSON.stringify([{ ...record, ...change }]));
      expect(loadSavedRequests()).toEqual([]);
      expect(() => renderToString(createElement(IMDJobs))).not.toThrow();
    }
    storage.set(STORAGE_KEY, JSON.stringify([record]));
    expect(loadSavedRequests()).toEqual([record]);
  });
  it('discards malformed saved signatures and signatures bound to another order or spender', async () => {
    const record = await saved(true);
    const decoded = JSON.parse(Buffer.from(record.signed!.paymentHeader, 'base64').toString());
    const paymentChanges = [
      { ...decoded, resource: { url: 'https://api.imd.fun/requests/other/submit' } },
      { ...decoded, accepted: { ...decoded.accepted, amount: '1' } },
      { ...decoded, payload: { ...decoded.payload, permit2Authorization: { ...decoded.payload.permit2Authorization, spender: PAYER } } },
      { ...decoded, extensions: { unrestricted: true } },
    ];
    for (const change of paymentChanges) {
      storage.set(STORAGE_KEY, JSON.stringify([{ ...record, signed: { ...record.signed, paymentHeader: Buffer.from(JSON.stringify(change)).toString('base64') } }]));
      expect(loadSavedRequests()).toEqual([]);
    }
    storage.set(STORAGE_KEY, JSON.stringify([{ ...record, signed: { ...record.signed, paymentHeader: 'not-base64' } }]));
    expect(loadSavedRequests()).toEqual([]);
    storage.set(STORAGE_KEY, JSON.stringify([record]));
    expect(loadSavedRequests()).toEqual([record]);
  });
  it('requires durable recovery storage and does not silently discard a failed write', async () => {
    const record = await saved(true);
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined });
    expect(() => saveRequest(record)).toThrow(/cannot save order recovery/);
  });
  it('reads the same order first and never resubmits a pending or admitted payment', async () => {
    const record = await saved(true);
    for (const state of ['payment_pending', 'admission_pending', 'admitted', 'payment_failed', 'expired']) {
      const fetcher = vi.fn(async (url: string) => { expect(url).toBe(`/api/requests?op=order&id=${ORDER_ID}`); return json(status(record, state)); });
      vi.stubGlobal('fetch', fetcher);
      const result = await submitSignedPayment(record);
      expect(result.status).toBe(state);
      expect(fetcher).toHaveBeenCalledOnce();
      expect(fetcher.mock.calls[0][0]).toBe(`/api/requests?op=order&id=${ORDER_ID}`);
    }
  });
  it('keeps identical signed bytes and order ID after a lost submission response', async () => {
    const record = await saved(true); saveRequest(record);
    const calls: { url: string; options: RequestInit }[] = [];
    const fetcher = vi.fn(async (url: string, options: RequestInit) => {
      calls.push({ url, options });
      if (options.method === 'GET') return json(status(record));
      throw new TypeError('Disconnected after send');
    });
    vi.stubGlobal('fetch', fetcher);
    await expect(submitSignedPayment(record)).rejects.toThrow(/Check this same order before retrying/);
    expect(loadSavedRequests()[0].signed).toEqual(record.signed);
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toBe(`/api/requests?op=submit&id=${ORDER_ID}`);
    expect(calls[1].options.headers).toHaveProperty('PAYMENT-SIGNATURE', record.signed!.paymentHeader);
    expect(calls[1].options.body).toBe(JSON.stringify({ quoteSignature: record.signed!.quoteSignature }));
    calls.length = 0;
    fetcher.mockImplementation(async (url: string, options: RequestInit) => { calls.push({ url, options }); return json(status(record, options.method === 'GET' ? 'quoted' : 'admitted')); });
    expect((await submitSignedPayment(loadSavedRequests()[0])).jobId).toBe(JOB_ID);
    expect(calls).toHaveLength(2);
    expect(calls[1].options.headers).toHaveProperty('PAYMENT-SIGNATURE', record.signed!.paymentHeader);
    expect(calls[1].options.body).toBe(JSON.stringify({ quoteSignature: record.signed!.quoteSignature }));
  });
  it('does not resend an expired signature or a mismatched saved payment', async () => {
    const record = await saved(true);
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(submitSignedPayment({ ...record, signed: { ...record.signed!, expiresAt: SECOND + 6 } })).rejects.toThrow(/expired/);
    await expect(submitSignedPayment({ ...record, signed: { ...record.signed!, payer: IMD_RECIPIENT } })).rejects.toThrow(/does not match/);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('requires matching paid admission records before exposing an actual job ID', async () => {
    const record = await saved(true);
    const bad = status(record, 'admitted'); bad.payment!.paid = false;
    const fetcher = vi.fn(async () => json(bad)); vi.stubGlobal('fetch', fetcher);
    expect((await submitSignedPayment(record)).jobId).toBeNull();
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('uses real blocker presence for brief readiness and keeps upstream prose out of markup', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ action: 'job.open', kind: 'report', judged: true,
      blockers: ['Missing a time range.'], suggestions: ['Name the relevant sources.'], plan: [{ skill: 'research-report', title: 'Research requested topic' }] })));
    expect(await checkResearch(input())).toEqual({ ok: false, problems: ['Missing a time range.'], suggestions: ['Name the relevant sources.'], plan: ['Research requested topic'] });
  });
  it('exposes only hash-addressed IMD Markdown files from a matching result record', async () => {
    const hash = '3'.repeat(64);
    vi.stubGlobal('fetch', vi.fn(async () => json({ jobId: JOB_ID, complete: true, state: 'complete', files: [
      { name: 'report', hash, mediaType: 'text/markdown', url: `https://api.imd.fun/artifacts/${hash}`, bytes: 200 },
      { name: 'external', hash, mediaType: 'text/markdown', url: `https://evil.invalid/artifacts/${hash}` },
      { name: 'html', hash, mediaType: 'text/html', url: `/artifacts/${hash}` },
    ] })));
    expect((await readResearchResult(JOB_ID)).files).toEqual([{ name: 'report', hash, url: `https://api.imd.fun/artifacts/${hash}`, bytes: 200 }]);
  });
});
