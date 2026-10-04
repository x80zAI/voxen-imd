import type { Address, EIP1193Provider, Hex, RecoverTypedDataAddressParameters, SignTypedDataParameters } from 'viem';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import type { ClientEvmSigner } from '@x402/evm';

export const IMD_TOKEN = '0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7' as Address;
export const IMD_RECIPIENT = '0x4e0fa57bde726079356537e2f34d671e9f41adbc' as Address;
export const PERMIT2 = '0x000000000022d473030f116ddee9f6b43ac78ba3' as Address;
export const PAYMENT_PROXY = '0x402085c248eea27d92e8b30b2c58ed07f9e20001' as Address;
export const MAX_JOB_AMOUNT = 500000000000000000n;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const SIGNATURE = /^0x[0-9a-f]{130}$/i;
const STORAGE_KEY = 'voxen.imd.requests.v1';
const MAX_RECORDS = 12;
const SOURCE = 'https://api.imd.fun';
const REQUEST_STATUSES = ['quoted', 'expired', 'payment_pending', 'payment_failed', 'admission_pending', 'admitted'];
const PERMIT_TYPES = {
  PermitWitnessTransferFrom: [{ name: 'permitted', type: 'TokenPermissions' }, { name: 'spender', type: 'address' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }, { name: 'witness', type: 'Witness' }],
  TokenPermissions: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' }],
  Witness: [{ name: 'to', type: 'address' }, { name: 'validAfter', type: 'uint256' }],
};

export type ResearchInput = { objective: string; skill: 'research-report'; outputs: [{ name: 'report'; path: 'artifacts/report.md'; mediaType: 'text/markdown' }]; minCitations: 5; github: false };
type PreparedResearchInput = ResearchInput & { contracts?: [] };
type Payment = { network: 'eip155:1'; asset: Address; amount: string; payTo: Address; decimals: 18; scheme?: 'exact' };
export type JobPolicy = { version: string; payment: Payment; quoteTtlSeconds: number; readAt: string };
export type Quote = { v: 1; id: string; action: 'job.open'; policyVersion: string; inputHash: string; issuedAt: number; expiresAt: number; payment: Payment & { scheme: 'exact' }; terms: { purchase: 'action-admission'; resultGuaranteed: false }; quoteHash: string; payer?: Address; unitAmount?: string; runs?: number };
export type Order = { id: string; requestKey: string; status: string; quote: Quote; inputJson: string; createdAt: string; paidAt: string | null };
export type SignedPayment = { paymentHeader: string; quoteSignature: Hex; expiresAt: number; payer: Address };
export type SavedRequest = { v: 1; token: string; requestKey: string; input: ResearchInput; createdAt: string; order?: Order; signed?: SignedPayment; lastStatus?: string; approvalHash?: Hex };
export type RequestStatus = { status: string; order: Order; transactionHash: Hex | null; jobId: string | null; refused: boolean };
export type JobResult = { jobId: string; state: string | null; complete: boolean | null; files: { name: string; hash: string; url: string; bytes: number | null }[]; readAt: string };
export type WalletConnection = { provider: BrowserProvider; address: Address; isActive?: () => boolean };
export type Funding = { balance: bigint; allowance: bigint; ethBalance: bigint };
export type BrowserProvider = EIP1193Provider & { on?: (event: string, listener: (...args: unknown[]) => void) => void; removeListener?: (event: string, listener: (...args: unknown[]) => void) => void };
type Challenge = { x402Version: 2; resource: { url: string; description?: string; mimeType?: string }; accepts: [PaymentRequirements]; quote: Quote; requesterScopeHash: string; resourceUrl: string; input: PreparedResearchInput };

export class JobError extends Error { constructor(message: string) { super(message); this.name = 'JobError'; } }
function fail(message = 'The IMD response could not be verified. Check the same order before continuing.'): never { throw new JobError(message); }
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function int(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function string(value: unknown, max = 120): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max; }
function address(value: unknown): value is Address { return typeof value === 'string' && ADDRESS.test(value) && !/^0x0{40}$/i.test(value); }
function sameAddress(value: unknown, expected: string) { return address(value) && value.toLowerCase() === expected.toLowerCase(); }
function keys(value: Record<string, unknown>, allowed: string[]) { if (Object.keys(value).some(key => !allowed.includes(key))) fail(); }
function amount(value: unknown): value is string { return typeof value === 'string' && /^[1-9][0-9]{0,77}$/.test(value) && BigInt(value) <= MAX_JOB_AMOUNT; }
function now() { return Math.floor(Date.now() / 1000); }

export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (object(value) && Object.getPrototypeOf(value) === Object.prototype) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return fail('The request contains an unsupported value.');
}
export async function canonicalHash(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(value)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function buildResearchInput(objective: string): ResearchInput {
  const text = objective.trim();
  if (!text || text.length > 8000) fail('Describe your research in 1 to 8,000 characters.');
  const input: ResearchInput = { objective: text, skill: 'research-report', outputs: [{ name: 'report', path: 'artifacts/report.md', mediaType: 'text/markdown' }], minCitations: 5, github: false };
  if (new TextEncoder().encode(JSON.stringify({ action: 'job.open', requestKey: '00000000-0000-4000-8000-000000000000', input })).length > 16000) fail('Shorten this brief so it fits the IMD request size limit.');
  return input;
}
function validateInput(value: unknown): ResearchInput {
  if (!object(value) || !string(value.objective, 8000)) fail();
  const expected = buildResearchInput(value.objective);
  if (canonicalJson(value) !== canonicalJson(expected)) fail('The prepared research brief changed. Review a new quote before paying.');
  return expected;
}
function validatePreparedInput(value: unknown): PreparedResearchInput {
  if (!object(value) || !string(value.objective, 8000)) fail();
  const requested = buildResearchInput(value.objective);
  // The IMD quote preparer adds an empty contracts list to research jobs.
  // Preserve that exact object for hashing, while rejecting any contract work or other added field.
  const expected = Object.hasOwn(value, 'contracts') ? { ...requested, contracts: [] } : requested;
  if (canonicalJson(value) !== canonicalJson(expected)) fail('The prepared research brief changed. Review a new quote before paying.');
  return value as PreparedResearchInput;
}
function validatePayment(value: unknown, schemeRequired: boolean): Payment {
  if (!object(value) || value.network !== 'eip155:1' || !sameAddress(value.asset, IMD_TOKEN) || !sameAddress(value.payTo, IMD_RECIPIENT) || value.decimals !== 18 || !amount(value.amount) || (schemeRequired && value.scheme !== 'exact')) fail('The payment does not match the supported Ethereum IMD research service.');
  keys(value, ['network', 'asset', 'amount', 'payTo', 'decimals', 'scheme']);
  return value as Payment;
}
export function validateCapabilities(value: unknown, readAt = new Date().toISOString()): JobPolicy {
  if (!object(value) || !Array.isArray(value.actions) || !object(value.authentication) || value.authentication.scheme !== 'Bearer' || value.authentication.tokenBytes !== 32 || value.authentication.encoding !== 'hex' || value.authentication.creator !== 'client' || !object(value.payment) || value.payment.x402Version !== 2 || value.payment.scheme !== 'exact' || value.payment.assetTransferMethod !== 'permit2' || value.payment.quoteApproval !== 'EIP-712') fail('IMD research payments are currently unavailable.');
  const matches = value.actions.filter(action => object(action) && action.action === 'job.open');
  if (matches.length !== 1 || !object(matches[0]) || !string(matches[0].version, 64) || !int(matches[0].quoteTtlSeconds) || matches[0].quoteTtlSeconds < 30 || matches[0].quoteTtlSeconds > 600) fail('The IMD research policy has changed. Payments are paused until it is reviewed.');
  return { version: matches[0].version, quoteTtlSeconds: matches[0].quoteTtlSeconds, payment: validatePayment(matches[0].payment, false), readAt };
}
function validateQuote(value: unknown): Quote {
  if (!object(value) || value.v !== 1 || typeof value.id !== 'string' || !UUID.test(value.id) || value.action !== 'job.open' || !string(value.policyVersion, 64) || typeof value.inputHash !== 'string' || !HASH.test(value.inputHash) || typeof value.quoteHash !== 'string' || !HASH.test(value.quoteHash) || !int(value.issuedAt) || !int(value.expiresAt) || value.expiresAt <= value.issuedAt || value.expiresAt - value.issuedAt > 600 || !object(value.terms) || value.terms.purchase !== 'action-admission' || value.terms.resultGuaranteed !== false || (value.payer !== undefined && !address(value.payer))) fail();
  keys(value, ['v', 'id', 'action', 'policyVersion', 'inputHash', 'issuedAt', 'expiresAt', 'payment', 'terms', 'quoteHash', 'payer', 'unitAmount', 'runs']);
  keys(value.terms, ['purchase', 'resultGuaranteed']);
  validatePayment(value.payment, true);
  if (value.runs !== undefined && value.runs !== 1) fail();
  if (value.unitAmount !== undefined && (!object(value.payment) || value.unitAmount !== value.payment.amount)) fail();
  return value as Quote;
}
export function requireCurrentQuote(quote: Quote, policy: JobPolicy, timestamp = now()) {
  if (quote.policyVersion !== policy.version || quote.payment.amount !== policy.payment.amount || !sameAddress(quote.payment.asset, policy.payment.asset) || !sameAddress(quote.payment.payTo, policy.payment.payTo) || quote.payment.network !== policy.payment.network || quote.expiresAt - quote.issuedAt > policy.quoteTtlSeconds || quote.issuedAt > timestamp + 30 || quote.expiresAt - timestamp < 30) fail('This quote expired or the IMD policy changed. Obtain and review a new quote.');
}
function validateOrderStructure(value: unknown, request: Pick<SavedRequest, 'requestKey' | 'input'>): Order {
  if (!object(value) || typeof value.id !== 'string' || !UUID.test(value.id) || value.requestKey !== request.requestKey || !['quoted', 'expired', 'payment_pending', 'payment_failed', 'paid'].includes(String(value.status)) || !string(value.inputJson, 16000) || !string(value.createdAt, 64) || !Number.isFinite(Date.parse(value.createdAt)) || (value.paidAt !== null && (!string(value.paidAt, 64) || !Number.isFinite(Date.parse(value.paidAt))))) fail();
  const quote = validateQuote(value.quote);
  if (quote.id !== value.id) fail();
  let input: unknown;
  try { input = JSON.parse(value.inputJson); } catch { return fail(); }
  const prepared = validatePreparedInput(input);
  if (canonicalJson(buildResearchInput(prepared.objective)) !== canonicalJson(request.input)) fail('The order does not match your saved research brief. Check the same order before continuing.');
  return value as Order;
}
export async function validateOrder(value: unknown, request: Pick<SavedRequest, 'requestKey' | 'input'>): Promise<Order> {
  const order = validateOrderStructure(value, request);
  if (await canonicalHash(JSON.parse(order.inputJson)) !== order.quote.inputHash) fail('The order does not match your saved research brief. Check the same order before continuing.');
  return order;
}
export async function validateChallenge(value: unknown, request: SavedRequest, policy: JobPolicy, timestamp = now()): Promise<Challenge> {
  if (!request.order || !object(value) || value.x402Version !== 2 || !object(value.resource) || !Array.isArray(value.accepts) || value.accepts.length !== 1 || typeof value.requesterScopeHash !== 'string' || !HASH.test(value.requesterScopeHash)) fail();
  const quote = validateQuote(value.quote);
  requireCurrentQuote(quote, policy, timestamp);
  if (canonicalJson(quote) !== canonicalJson(request.order.quote)) fail('The quote changed. Review a new quote before paying.');
  const resource = `${SOURCE}/requests/${request.order.id}/submit`;
  if (value.resourceUrl !== resource || value.resource.url !== resource) fail('The payment request points to a different order.');
  keys(value.resource, ['url', 'description', 'mimeType']);
  if ((value.resource.description !== undefined && !string(value.resource.description, 2000)) || (value.resource.mimeType !== undefined && value.resource.mimeType !== 'application/json')) fail();
  const prepared = validatePreparedInput(value.input);
  if (canonicalJson(buildResearchInput(prepared.objective)) !== canonicalJson(request.input) || canonicalJson(prepared) !== canonicalJson(JSON.parse(request.order.inputJson)) || await canonicalHash(prepared) !== quote.inputHash) fail('The prepared research brief changed. No signature was requested for this changed brief.');
  const req = value.accepts[0];
  if (!object(req) || req.scheme !== 'exact' || req.network !== quote.payment.network || !sameAddress(req.asset, quote.payment.asset) || req.amount !== quote.payment.amount || !sameAddress(req.payTo, quote.payment.payTo) || !int(req.maxTimeoutSeconds) || req.maxTimeoutSeconds < 7 || req.maxTimeoutSeconds > 600 || !object(req.extra) || req.extra.assetTransferMethod !== 'permit2') fail();
  keys(req, ['scheme', 'network', 'asset', 'amount', 'payTo', 'maxTimeoutSeconds', 'extra']);
  keys(req.extra, ['assetTransferMethod']);
  return value as Challenge;
}

async function requestApi(op: string, options: { id?: string; token?: string; body?: unknown; method?: 'GET' | 'POST'; paymentHeader?: string; challenge?: boolean; signal?: AbortSignal } = {}) {
  if (options.id && !UUID.test(options.id)) fail('The saved order ID is invalid.');
  if (options.token && !HASH.test(options.token)) fail('The saved order access is invalid.');
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.paymentHeader) headers['PAYMENT-SIGNATURE'] = options.paymentHeader;
  let response: Response;
  try { response = await fetch(`/api/requests?${new URLSearchParams({ op, ...(options.id ? { id: options.id } : {}) })}`, { method: options.method ?? 'GET', headers, ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}), redirect: 'error', cache: 'no-store', credentials: 'same-origin', signal: options.signal }); }
  catch { return fail(options.paymentHeader ? 'The submission response was lost. Check this same order before retrying; do not create a second paid order.' : 'The IMD service could not be reached. Try again.'); }
  const raw = await response.text();
  if (raw.length > 1024 * 1024) fail('The IMD response exceeds the supported size.');
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return fail('The IMD service returned an unreadable response. Check the order status if a payment was submitted.'); }
  if (!(options.challenge && response.status === 402) && !response.ok) {
    if (response.status === 429) fail('IMD is receiving too many requests. Wait a moment and check the same order again.');
    if (response.status === 503) fail('IMD is temporarily unavailable. Any submitted payment must be checked through the same order.');
    if (response.status === 401 || response.status === 403) fail('This browser cannot access that order, or its access has expired.');
    fail(options.paymentHeader ? 'IMD did not confirm this submission. Check the same order before retrying.' : 'IMD could not accept this request. Review your brief and try again.');
  }
  if (options.challenge && response.status !== 402) fail('The order did not return a payment challenge. Check its status before continuing.');
  return { payload, paymentRequired: response.headers.get('PAYMENT-REQUIRED') };
}
export async function readJobPolicy(signal?: AbortSignal) { return validateCapabilities((await requestApi('capabilities', { signal })).payload); }
export async function checkResearch(input: ResearchInput) {
  const value = (await requestApi('check', { method: 'POST', body: { action: 'job.open', input } })).payload;
  if (!object(value) || value.action !== 'job.open' || value.kind !== 'report' || value.judged !== true || !Array.isArray(value.blockers) || !Array.isArray(value.suggestions) || !Array.isArray(value.plan)) fail('IMD could not verify the research brief.');
  const textOnly = (values: unknown[]) => values.filter((item): item is string => typeof item === 'string' && !/\b(?:demo|demonstration|example|testnet|prototype|sandbox|simulation|mock)\b/i.test(item)).slice(0, 10).map(item => item.slice(0, 500));
  const problems = textOnly(value.blockers);
  const suggestions = textOnly(value.suggestions);
  const plan = value.plan.filter(item => object(item) && item.skill === 'research-report' && string(item.title, 300)).map(item => (item as Record<string, unknown>).title as string).filter(item => !/\b(?:demo|demonstration|example|testnet|prototype|sandbox|simulation|mock)\b/i.test(item)).slice(0, 8);
  return { ok: value.blockers.length === 0, problems, suggestions, plan };
}
export function loadSavedRequests(): SavedRequest[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw || raw.length > 600000) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.slice(0, MAX_RECORDS).flatMap(record => {
      if (!object(record) || record.v !== 1 || typeof record.token !== 'string' || !HASH.test(record.token) || typeof record.requestKey !== 'string' || !UUID.test(record.requestKey) || !string(record.createdAt, 64) || !Number.isFinite(Date.parse(record.createdAt))) return [];
      try {
        const input = validateInput(record.input);
        if (record.order !== undefined) validateOrderStructure(record.order, { requestKey: record.requestKey, input });
        if (record.lastStatus !== undefined && !REQUEST_STATUSES.includes(String(record.lastStatus))) return [];
        if (record.approvalHash !== undefined && (typeof record.approvalHash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(record.approvalHash))) return [];
        if (record.signed !== undefined) validateSavedPayment(record as SavedRequest);
        return [record as SavedRequest];
      } catch { return []; }
    });
  } catch { return []; }
}
function validateSavedPayment(request: SavedRequest) {
  const signed: unknown = request.signed;
  if (!request.order || !object(signed) || !string(signed.paymentHeader, 12288) || !/^[A-Za-z0-9+/]+=*$/.test(signed.paymentHeader) || typeof signed.quoteSignature !== 'string' || !SIGNATURE.test(signed.quoteSignature) || !int(signed.expiresAt) || !address(signed.payer)) fail('The saved signed request is invalid. Check its order before continuing.');
  let payment: unknown;
  try { payment = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(signed.paymentHeader), char => char.charCodeAt(0)))); } catch { return fail('The saved signed request is unreadable.'); }
  if (!object(payment) || payment.x402Version !== 2 || !object(payment.resource) || payment.resource.url !== `${SOURCE}/requests/${request.order.id}/submit` || !object(payment.accepted) || payment.accepted.scheme !== 'exact' || payment.accepted.network !== 'eip155:1' || !sameAddress(payment.accepted.asset, IMD_TOKEN) || !sameAddress(payment.accepted.payTo, request.order.quote.payment.payTo) || payment.accepted.amount !== request.order.quote.payment.amount || !int(payment.accepted.maxTimeoutSeconds) || payment.accepted.maxTimeoutSeconds > 600 || !object(payment.accepted.extra) || payment.accepted.extra.assetTransferMethod !== 'permit2' || !object(payment.payload) || typeof payment.payload.signature !== 'string' || !SIGNATURE.test(payment.payload.signature) || !object(payment.payload.permit2Authorization)) fail('The saved signature does not match this IMD research order.');
  keys(payment, ['x402Version', 'resource', 'accepted', 'payload']);
  keys(payment.resource, ['url', 'description', 'mimeType']);
  keys(payment.accepted, ['scheme', 'network', 'asset', 'amount', 'payTo', 'maxTimeoutSeconds', 'extra']);
  keys(payment.accepted.extra, ['assetTransferMethod']);
  keys(payment.payload, ['signature', 'permit2Authorization']);
  const permit = payment.payload.permit2Authorization;
  keys(permit, ['from', 'permitted', 'spender', 'nonce', 'deadline', 'witness']);
  if (!sameAddress(permit.from, signed.payer) || !object(permit.permitted) || !sameAddress(permit.permitted.token, IMD_TOKEN) || permit.permitted.amount !== request.order.quote.payment.amount || !sameAddress(permit.spender, PAYMENT_PROXY) || !object(permit.witness) || !sameAddress(permit.witness.to, request.order.quote.payment.payTo) || permit.witness.validAfter !== '0' || typeof permit.nonce !== 'string' || !/^[0-9]{1,78}$/.test(permit.nonce) || BigInt(permit.nonce) >= 2n ** 256n || permit.deadline !== String(signed.expiresAt) || signed.expiresAt >= request.order.quote.expiresAt) fail('The saved payment authorization does not match this order.');
  keys(permit.permitted, ['token', 'amount']);
  keys(permit.witness, ['to', 'validAfter']);
}
export function saveRequest(request: SavedRequest) {
  const records = loadSavedRequests();
  const next = [request, ...records.filter(record => record.requestKey !== request.requestKey)].slice(0, MAX_RECORDS);
  try {
    const encoded = JSON.stringify(next);
    localStorage.setItem(STORAGE_KEY, encoded);
    if (localStorage.getItem(STORAGE_KEY) !== encoded) fail();
  } catch { fail('This browser cannot save order recovery. Enable local browser storage before creating or paying for an order.'); }
}
export function createSavedRequest(input: ResearchInput): SavedRequest {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
  const request: SavedRequest = { v: 1, token, requestKey: crypto.randomUUID(), input, createdAt: new Date().toISOString() };
  saveRequest(request);
  return request;
}
export async function quoteResearch(request: SavedRequest, policy: JobPolicy): Promise<SavedRequest> {
  if (request.order || request.signed) fail('Recover the existing order instead of creating another quote.');
  const response = (await requestApi('quote', { method: 'POST', token: request.token, body: { requestKey: request.requestKey, action: 'job.open', input: request.input } })).payload;
  if (!object(response) || typeof response.created !== 'boolean') fail();
  const order = await validateOrder(response.order, request);
  requireCurrentQuote(order.quote, policy);
  if (order.status !== 'quoted') fail('This order already has a payment state. Recover its status before continuing.');
  const next = { ...request, order, lastStatus: 'quoted' };
  saveRequest(next);
  return next;
}
export function injectedProvider(): BrowserProvider | null { return (window as unknown as { ethereum?: BrowserProvider }).ethereum ?? null; }
export async function connectWallet(): Promise<WalletConnection> {
  const provider = injectedProvider();
  if (!provider) fail('Install or open an Ethereum wallet with an in-browser connection.');
  try {
    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    if (!Array.isArray(accounts) || !address(accounts[0])) fail('No wallet account was selected.');
    const wallet = { provider, address: accounts[0] };
    await verifyWallet(wallet);
    return wallet;
  } catch (error) { if (error instanceof JobError) throw error; return fail('Wallet connection was declined. Choose an account on Ethereum mainnet and try again.'); }
}
export async function verifyWallet(wallet: WalletConnection) {
  if (wallet.isActive && !wallet.isActive()) fail('The selected wallet connection changed. Connect again before signing.');
  const [accounts, chain] = await Promise.all([wallet.provider.request({ method: 'eth_accounts' }), wallet.provider.request({ method: 'eth_chainId' })]);
  if (chain !== '0x1') fail('Switch your wallet to Ethereum mainnet, then connect again.');
  if (!Array.isArray(accounts) || !sameAddress(accounts[0], wallet.address)) fail('The wallet account changed. Connect the selected account again.');
  if (wallet.isActive && !wallet.isActive()) fail('The selected wallet connection changed. Connect again before signing.');
}
const ERC20_ABI = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const;
async function walletClients(wallet: WalletConnection) {
  await verifyWallet(wallet);
  const [{ createPublicClient, createWalletClient, custom }, { mainnet }] = await Promise.all([import('viem'), import('viem/chains')]);
  return { publicClient: createPublicClient({ chain: mainnet, transport: custom(wallet.provider) }), walletClient: createWalletClient({ chain: mainnet, account: wallet.address, transport: custom(wallet.provider) }) };
}
export async function readFunding(wallet: WalletConnection): Promise<Funding> {
  const { publicClient } = await walletClients(wallet);
  const [balance, allowance, ethBalance] = await Promise.all([publicClient.readContract({ address: IMD_TOKEN, abi: ERC20_ABI, functionName: 'balanceOf', args: [wallet.address] }), publicClient.readContract({ address: IMD_TOKEN, abi: ERC20_ABI, functionName: 'allowance', args: [wallet.address, PERMIT2] }), publicClient.getBalance({ address: wallet.address })]);
  await verifyWallet(wallet);
  return { balance, allowance, ethBalance };
}
export async function approveExactAmount(wallet: WalletConnection, request: SavedRequest, policy: JobPolicy, onSubmitted?: (hash: Hex) => void): Promise<Hex> {
  if (!request.order || request.signed) fail('Obtain an unpaid quote before approving IMD.');
  requireCurrentQuote(request.order.quote, policy);
  const { publicClient, walletClient } = await walletClients(wallet);
  const required = BigInt(request.order.quote.payment.amount);
  const funds = await readFunding(wallet);
  if (funds.balance < required) fail('This wallet does not hold enough IMD for the quoted cost.');
  if (funds.allowance >= required) fail('This wallet already has enough IMD allowance.');
  if (funds.ethBalance === 0n) fail('This wallet needs ETH to pay the Ethereum fee for the IMD approval.');
  if (request.approvalHash) {
    await publicClient.getTransactionReceipt({ hash: request.approvalHash }).catch(() => fail('The previous IMD approval is still pending or its confirmation is unavailable. Open its saved transaction and refresh the wallet before approving again.'));
  }
  requireCurrentQuote(request.order.quote, policy);
  await verifyWallet(wallet);
  let hash: Hex;
  try { hash = await walletClient.writeContract({ address: IMD_TOKEN, abi: ERC20_ABI, functionName: 'approve', args: [PERMIT2, required] }); }
  catch { return fail('The IMD approval was not confirmed. Check your wallet transaction history before trying again.'); }
  onSubmitted?.(hash);
  try { saveRequest({ ...request, approvalHash: hash }); } catch { fail('The approval transaction was sent, but browser recovery could not be saved. Keep the displayed transaction reference and check your wallet before continuing.'); }
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120000 }).catch(() => fail('The IMD approval confirmation is pending or temporarily unavailable. Open its saved transaction or refresh the wallet before approving again.'));
  if (receipt.status !== 'success') fail('The IMD approval transaction failed.');
  await verifyWallet(wallet);
  if ((await readFunding(wallet)).allowance < required) fail('The IMD approval is not yet confirmed in the wallet allowance.');
  return hash;
}

function quoteApproval(challenge: Challenge, paymentHash: string) {
  const q = challenge.quote;
  return {
    domain: { name: 'IdentityMD Paid Action', version: '1', chainId: 1 }, primaryType: 'QuoteApproval',
    types: { QuoteApproval: [{ name: 'resource', type: 'string' }, { name: 'requesterScopeHash', type: 'bytes32' }, { name: 'quoteId', type: 'string' }, { name: 'quoteHash', type: 'bytes32' }, { name: 'paymentHash', type: 'bytes32' }, { name: 'action', type: 'string' }, { name: 'asset', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'payTo', type: 'address' }, { name: 'expiresAt', type: 'uint256' }] },
    message: { resource: challenge.resourceUrl, requesterScopeHash: `0x${challenge.requesterScopeHash}`, quoteId: q.id, quoteHash: `0x${q.quoteHash}`, paymentHash: `0x${paymentHash}`, action: q.action, asset: q.payment.asset, amount: BigInt(q.payment.amount), payTo: q.payment.payTo, expiresAt: BigInt(q.expiresAt) },
  } as const;
}
export function validatePermitMessage(data: Parameters<ClientEvmSigner['signTypedData']>[0], quote: Quote, timestamp = now()) {
  const { domain, primaryType, message } = data;
  if (canonicalJson(data.types) !== canonicalJson(PERMIT_TYPES) || domain.name !== 'Permit2' || Number(domain.chainId) !== 1 || !sameAddress(domain.verifyingContract, PERMIT2) || primaryType !== 'PermitWitnessTransferFrom' || !object(message.permitted) || !sameAddress(message.permitted.token, IMD_TOKEN) || String(message.permitted.amount) !== quote.payment.amount || !sameAddress(message.spender, PAYMENT_PROXY) || !object(message.witness) || !sameAddress(message.witness.to, quote.payment.payTo) || String(message.witness.validAfter) !== '0' || !/^[0-9]{1,78}$/.test(String(message.nonce)) || BigInt(String(message.nonce)) >= 2n ** 256n || !/^[0-9]+$/.test(String(message.deadline))) fail('The wallet signature does not match the reviewed research payment.');
  const deadline = BigInt(String(message.deadline));
  keys(domain, ['name', 'chainId', 'verifyingContract']);
  keys(message, ['permitted', 'spender', 'nonce', 'deadline', 'witness']);
  keys(message.permitted as Record<string, unknown>, ['token', 'amount']);
  keys(message.witness as Record<string, unknown>, ['to', 'validAfter']);
  if (deadline <= BigInt(timestamp + 6) || deadline >= BigInt(quote.expiresAt)) fail('The payment window expired. Obtain and review a fresh quote.');
}
export async function signResearchPayment(wallet: WalletConnection, request: SavedRequest, policy: JobPolicy): Promise<SavedRequest> {
  if (!request.order || request.signed) fail('This order cannot receive another payment signature. Check its current status.');
  requireCurrentQuote(request.order.quote, policy);
  if (request.order.quote.payer && !sameAddress(request.order.quote.payer, wallet.address)) fail('This quote was prepared for a different wallet.');
  const funds = await readFunding(wallet);
  const required = BigInt(request.order.quote.payment.amount);
  if (funds.balance < required) fail('This wallet does not hold enough IMD for the quoted cost.');
  if (funds.allowance < required) fail('Approve exactly the quoted IMD amount before paying for this order.');
  const response = await requestApi('challenge', { id: request.order.id, token: request.token, method: 'POST', challenge: true });
  const challenge = await validateChallenge(response.payload, request, policy);
  if (!response.paymentRequired || response.paymentRequired.length > 12288) fail('The IMD payment challenge header is missing or unsupported.');
  const [{ x402Client }, { encodePaymentSignatureHeader, decodePaymentRequiredHeader }, { ExactEvmScheme }] = await Promise.all([import('@x402/core/client'), import('@x402/core/http'), import('@x402/evm/exact/client')]);
  const header = decodePaymentRequiredHeader(response.paymentRequired);
  if (header.x402Version !== 2 || canonicalJson(header.accepts) !== canonicalJson(challenge.accepts) || canonicalJson(header.resource) !== canonicalJson(challenge.resource)) fail('The payment header differs from the reviewed challenge.');
  const { walletClient } = await walletClients(wallet);
  const { recoverTypedDataAddress } = await import('viem');
  let signedDeadline = 0;
  const signer: ClientEvmSigner = { address: wallet.address, signTypedData: async data => {
    requireCurrentQuote(challenge.quote, policy);
    validatePermitMessage(data, challenge.quote);
    await verifyWallet(wallet);
    signedDeadline = Number(data.message.deadline);
    const signature = await walletClient.signTypedData(data as unknown as SignTypedDataParameters);
    await verifyWallet(wallet);
    const recovered = await recoverTypedDataAddress({ ...data, signature } as unknown as RecoverTypedDataAddressParameters);
    if (!sameAddress(recovered, wallet.address)) fail('The payment signature does not belong to the selected wallet. No request was submitted.');
    return signature;
  } };
  const req = challenge.accepts[0];
  // x402 treats this as the maximum signing window. The original requirements stay in the transmitted payload.
  const boundedRequirements = { ...req, maxTimeoutSeconds: Math.min(req.maxTimeoutSeconds, challenge.quote.expiresAt - now() - 20) };
  if (boundedRequirements.maxTimeoutSeconds < 10) fail('The payment window is too short. Review a fresh quote.');
  const client = x402Client.fromConfig({ schemes: [{ network: 'eip155:1', client: new ExactEvmScheme(signer) }] });
  let generated: PaymentPayload;
  try { generated = await client.createPaymentPayload({ x402Version: 2, resource: challenge.resource, accepts: [boundedRequirements] }); }
  catch (error) { if (error instanceof JobError) throw error; return fail('The payment signature was declined. No payment was submitted.'); }
  const payment: PaymentPayload = { x402Version: 2, resource: challenge.resource, accepted: req, payload: generated.payload };
  requireCurrentQuote(challenge.quote, policy);
  if (signedDeadline <= now() + 6) fail('The payment signature expired before submission. No payment was submitted.');
  const paymentHash = await canonicalHash(payment);
  await verifyWallet(wallet);
  let quoteSignature: Hex;
  const approval = quoteApproval(challenge, paymentHash);
  try { quoteSignature = await walletClient.signTypedData(approval); }
  catch { return fail('The quote approval signature was declined. No payment was submitted.'); }
  await verifyWallet(wallet);
  const approvalPayer = await recoverTypedDataAddress({ ...approval, signature: quoteSignature });
  if (!sameAddress(approvalPayer, wallet.address)) fail('The quote signature does not belong to the payment wallet. No request was submitted.');
  if (!SIGNATURE.test(quoteSignature) || signedDeadline <= now() + 6 || challenge.quote.expiresAt <= now()) fail('The payment signing window expired. No payment was submitted.');
  const paymentHeader = encodePaymentSignatureHeader(payment);
  if (paymentHeader.length > 12288) fail();
  const next: SavedRequest = { ...request, signed: { paymentHeader, quoteSignature, payer: wallet.address, expiresAt: signedDeadline } };
  validateSavedPayment(next);
  saveRequest(next);
  return next;
}
async function validateStatus(value: unknown, request: SavedRequest): Promise<RequestStatus> {
  if (!request.order || !object(value) || !REQUEST_STATUSES.includes(String(value.status))) fail('The order status could not be verified. Check this same order again.');
  const order = await validateOrder(value.order, request);
  if (order.id !== request.order.id || canonicalJson(order.quote) !== canonicalJson(request.order.quote)) fail('The returned order does not match your saved request.');
  let transactionHash: Hex | null = null;
  if (object(value.payment) && typeof value.payment.transactionHash === 'string' && /^0x[0-9a-f]{64}$/i.test(value.payment.transactionHash)) transactionHash = value.payment.transactionHash as Hex;
  let jobId: string | null = null;
  let refused = false;
  if (value.status === 'admitted' && object(value.admission) && object(value.admission.result)) {
    const result = value.admission.result;
    refused = result.kind === 'refused';
    if (result.kind === 'job' && result.launch === false && typeof result.jobId === 'string' && UUID.test(result.jobId) && result.statusUrl === `/jobs/${result.jobId}` && result.resultUrl === `/jobs/${result.jobId}/result` && object(value.payment) && value.payment.paid === true && value.payment.status === 'confirmed' && order.status === 'paid') jobId = result.jobId;
  }
  return { status: String(value.status), order, transactionHash, jobId, refused };
}
export async function readRequestStatus(request: SavedRequest): Promise<RequestStatus> {
  if (!request.order) fail('Recover the quote before reading this order.');
  const status = await validateStatus((await requestApi('order', { id: request.order.id, token: request.token })).payload, request);
  saveRequest({ ...request, order: status.order, lastStatus: status.status });
  return status;
}
export async function submitSignedPayment(request: SavedRequest): Promise<RequestStatus> {
  if (!request.order || !request.signed || request.signed.expiresAt <= now() + 6 || request.order.quote.expiresAt <= now()) fail('This signed payment expired. Check the same order before obtaining another quote.');
  validateSavedPayment(request);
  // Always reconcile first. Only a still-unpaid order can receive a manual retry of the identical bytes.
  const before = await readRequestStatus(request);
  if (['payment_pending', 'admission_pending', 'admitted', 'expired', 'payment_failed'].includes(before.status)) return before;
  return validateStatus((await requestApi('submit', { id: request.order.id, token: request.token, method: 'POST', paymentHeader: request.signed.paymentHeader, body: { quoteSignature: request.signed.quoteSignature } })).payload, request);
}
export async function readResearchResult(jobId: string): Promise<JobResult> {
  if (!UUID.test(jobId)) fail('The research job ID is invalid.');
  const value = (await requestApi('job', { id: jobId })).payload;
  if (!object(value) || value.jobId !== jobId || !Array.isArray(value.files) || value.files.length > 200 || (value.complete !== null && typeof value.complete !== 'boolean')) fail('The research result could not be verified.');
  const files = value.files.flatMap(file => {
    if (!object(file) || typeof file.hash !== 'string' || !HASH.test(file.hash)) return [];
    const url = `${SOURCE}/artifacts/${file.hash}`;
    const name = string(file.name, 256) ? file.name : string(file.path, 256) ? file.path : '';
    if (!name || (file.url !== url && file.url !== `/artifacts/${file.hash}`) || file.mediaType !== 'text/markdown') return [];
    return [{ name, hash: file.hash, url, bytes: int(file.bytes) ? file.bytes : null }];
  });
  return { jobId, state: string(value.state, 80) ? value.state : null, complete: value.complete as boolean | null, files, readAt: new Date().toISOString() };
}
export function imdAmount(value: string | bigint) {
  const raw = BigInt(value);
  return `${raw / 10n ** 18n}${raw % 10n ** 18n ? `.${(raw % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '')}` : ''}`;
}
export function jobErrorMessage(error: unknown) { return error instanceof JobError ? error.message : 'The wallet or IMD service could not complete this action. Check the same order before continuing.'; }
