import { useEffect, useRef, useState } from 'react';
import { ArrowClockwise, ArrowUpRight, Check, FileText, Wallet } from '@phosphor-icons/react';
import { approveExactAmount, buildResearchInput, checkResearch, connectWallet, createSavedRequest, imdAmount, jobErrorMessage, loadSavedRequests, quoteResearch, readFunding, readJobPolicy, readRequestStatus, readResearchResult, requireCurrentQuote, saveRequest, signResearchPayment, submitSignedPayment } from './imd-jobs';
import type { Funding, JobPolicy, JobResult, RequestStatus, SavedRequest, WalletConnection } from './imd-jobs';

type BriefCheck = Awaited<ReturnType<typeof checkResearch>> & { objective: string };
const statusText: Record<string, string> = { quoted: 'Quote ready', expired: 'Quote expired', payment_pending: 'Payment confirmation pending', payment_failed: 'Payment failed', admission_pending: 'Payment received · admission pending', admitted: 'Admitted to the IMD network' };
function short(value: string) { return `${value.slice(0, 7)}…${value.slice(-5)}`; }
function expires(value: number) { return new Date(value * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }); }

export default function IMDJobs() {
  const [policy, setPolicy] = useState<JobPolicy | null>(null);
  const [policyError, setPolicyError] = useState('');
  const [objective, setObjective] = useState('');
  const [checked, setChecked] = useState<BriefCheck | null>(null);
  const [wallet, setWallet] = useState<WalletConnection | null>(null);
  const [funding, setFunding] = useState<Funding | null>(null);
  const [request, setRequest] = useState<SavedRequest | null>(null);
  const [records, setRecords] = useState(loadSavedRequests);
  const [status, setStatus] = useState<RequestStatus | null>(null);
  const [result, setResult] = useState<JobResult | null>(null);
  const [approvalHash, setApprovalHash] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [timestamp, setTimestamp] = useState(() => Math.floor(Date.now() / 1000));
  const lock = useRef(false);
  const mounted = useRef(true);
  const walletEpoch = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    mounted.current = true;
    readJobPolicy(controller.signal).then(value => { if (!controller.signal.aborted) setPolicy(value); }).catch(reason => { if (!controller.signal.aborted) setPolicyError(jobErrorMessage(reason)); });
    const clock = setInterval(() => setTimestamp(Math.floor(Date.now() / 1000)), 1000);
    return () => { mounted.current = false; controller.abort(); clearInterval(clock); };
  }, []);
  useEffect(() => {
    if (!wallet?.provider.on) return;
    const change = () => { ++walletEpoch.current; setWallet(null); setFunding(null); setNotice('Your wallet changed. Connect the selected Ethereum account before signing again.'); };
    wallet.provider.on('accountsChanged', change);
    wallet.provider.on('chainChanged', change);
    return () => { wallet.provider.removeListener?.('accountsChanged', change); wallet.provider.removeListener?.('chainChanged', change); };
  }, [wallet]);

  const run = async (label: string, action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(label); setError(''); setNotice('');
    try { await action(); }
    catch (reason) { if (mounted.current) setError(jobErrorMessage(reason)); }
    finally { lock.current = false; if (mounted.current) { setBusy(''); setRecords(loadSavedRequests()); } }
  };
  const currentPolicy = async () => {
    const latest = await readJobPolicy();
    if (mounted.current) { setPolicy(latest); setPolicyError(''); }
    return latest;
  };
  const rememberStatus = (saved: SavedRequest, value: RequestStatus) => {
    const next = { ...saved, order: value.order, lastStatus: value.status };
    saveRequest(next);
    if (mounted.current) { setRequest(next); setStatus(value); }
    return next;
  };
  const refreshStatus = (saved = request) => run('Checking order', async () => {
    if (!saved) return;
    if (!saved.order) {
      const recovered = await quoteResearch(saved, await currentPolicy());
      if (mounted.current) { setRequest(recovered); setStatus(null); setResult(null); setObjective(recovered.input.objective); }
      return;
    }
    const value = await readRequestStatus(saved);
    rememberStatus(saved, value);
    if (mounted.current) { setObjective(saved.input.objective); setResult(null); }
    if (value.jobId) {
      const actual = await readResearchResult(value.jobId);
      if (mounted.current) setResult(actual);
    }
  });
  const check = () => run('Checking brief', async () => {
    const input = buildResearchInput(objective);
    const value = await checkResearch(input);
    if (mounted.current) setChecked({ ...value, objective: input.objective });
  });
  const getQuote = () => run('Preparing quote', async () => {
    const input = buildResearchInput(objective);
    if (!checked?.ok || checked.objective !== input.objective) return;
    const latest = await currentPolicy();
    // Persist access before the request. A lost response is recovered with this same request key.
    const saved = request ?? createSavedRequest(input);
    if (mounted.current) setRequest(saved);
    const next = await quoteResearch(saved, latest);
    if (mounted.current) { setRequest(next); setStatus(null); setResult(null); }
  });
  const connect = () => run('Connecting wallet', async () => {
    const value = await connectWallet();
    const epoch = ++walletEpoch.current;
    const connected = { ...value, isActive: () => mounted.current && epoch === walletEpoch.current };
    const funds = await readFunding(connected);
    if (mounted.current) { setWallet(connected); setFunding(funds); }
  });
  const refreshFunds = () => run('Reading wallet', async () => { if (wallet) { const funds = await readFunding(wallet); if (mounted.current) setFunding(funds); } });
  const approve = () => run('Approving exact IMD amount', async () => {
    if (!wallet || !request?.order) return;
    const latest = await currentPolicy();
    const before = await readRequestStatus(request);
    rememberStatus(request, before);
    if (before.status !== 'quoted') return;
    const hash = await approveExactAmount(wallet, request, latest, value => { if (mounted.current) { setApprovalHash(value); setRequest(saved => saved ? { ...saved, approvalHash: value } : saved); setNotice('Approval transaction sent. Waiting for Ethereum confirmation.'); } });
    const funds = await readFunding(wallet);
    if (mounted.current) { setApprovalHash(hash); setFunding(funds); setNotice('The exact IMD allowance is confirmed. Review the quote again before paying.'); }
  });
  const pay = () => run('Signing and submitting research', async () => {
    if (!wallet || !request?.order || request.signed) return;
    const latest = await currentPolicy();
    requireCurrentQuote(request.order.quote, latest);
    const before = await readRequestStatus(request);
    rememberStatus(request, before);
    if (before.status !== 'quoted') return;
    const next = await signResearchPayment(wallet, request, latest);
    if (mounted.current) setRequest(next);
    const value = await submitSignedPayment(next);
    rememberStatus(next, value);
    if (mounted.current) setNotice('The signed request was sent. Use Check order to follow its confirmed status and report.');
  });
  const retry = () => run('Retrying the same signed request', async () => {
    if (!request?.signed) return;
    const value = await submitSignedPayment(request);
    rememberStatus(request, value);
  });
  const newBrief = () => {
    if (busy || request?.signed && !['admitted', 'expired', 'payment_failed'].includes(status?.status ?? request.lastStatus ?? '')) return;
    setRequest(null); setStatus(null); setResult(null); setChecked(null); setObjective(''); setApprovalHash(''); setError(''); setNotice('');
  };

  const quote = request?.order?.quote;
  const cost = quote?.payment.amount ?? policy?.payment.amount;
  const required = cost ? BigInt(cost) : null;
  const expired = !!quote && quote.expiresAt - timestamp < 30;
  const balanceEnough = required !== null && !!funding && funding.balance >= required;
  const allowanceEnough = required !== null && !!funding && funding.allowance >= required;
  const knownStatus = status?.status ?? request?.lastStatus;
  const unsettled = !!request?.signed && !['admitted', 'expired', 'payment_failed'].includes(knownStatus ?? '');
  const canQuote = !!policy && checked?.ok && checked.objective === objective.trim() && !request?.order;
  const quoted = !!quote && (!knownStatus || knownStatus === 'quoted') && !expired;

  return <section className="imd-jobs-section" id="imd-jobs" aria-labelledby="imd-jobs-title">
    <div className="imd-jobs-heading"><div><span className="imd-jobs-eyebrow">IMD RESEARCH DESK</span><h2 id="imd-jobs-title">Put the network to work.</h2><p className="imd-jobs-intro">Send your research brief to IMD agents. Review the price, sign with your Ethereum wallet, and follow the source-confirmed job.</p></div><FileText size={44} weight="duotone" aria-hidden="true" /></div>
    <div className="imd-job-availability"><span className={`dot ${policy ? '' : 'muted'}`} />{policy ? <>Current IMD admission price: <strong>{imdAmount(policy.payment.amount)} IMD</strong> · Ethereum mainnet</> : 'Reading the current IMD research policy…'}{policy && <small>Read {new Date(policy.readAt).toLocaleString('en-GB')}</small>}</div>
    {policyError && <div className="notice" role="alert"><p>{policyError}</p><button className="text-btn" disabled={!!busy} onClick={() => run('Reading policy', async () => { await currentPolicy(); })}>Read policy again <ArrowClockwise /></button></div>}
    <div className="imd-jobs-grid"><div className="imd-job-brief">
      <form onSubmit={event => { event.preventDefault(); check(); }}>
        <label htmlFor="imd-research-objective">Your research brief</label>
        <textarea id="imd-research-objective" rows={6} maxLength={8000} placeholder="Describe the question, time period, sources, and format you need." value={objective} readOnly={!!request} disabled={!!busy} onChange={event => { setObjective(event.target.value); setChecked(null); setError(''); }} />
        <div className="imd-brief-meta"><small>{objective.length.toLocaleString('en-US')} / 8,000 characters</small><small>Markdown report · minimum 5 citations · no repository publishing</small></div>
        <div className="imd-job-actions"><button className="btn dark" disabled={!!busy || !objective.trim() || !!request}>{busy === 'Checking brief' ? 'Checking…' : 'Check brief'} <Check /></button><button className="btn violet" type="button" disabled={!!busy || !canQuote} onClick={getQuote}>Get quote <ArrowUpRight /></button></div>
      </form>
      {checked && <div className={`imd-brief-check ${checked.ok ? 'ready' : ''}`} role="status"><strong>{checked.ok ? 'The IMD service found no brief blockers.' : 'The IMD service needs changes to this brief.'}</strong>{checked.plan.map((item, index) => <p key={`plan-${index}`}>{item}</p>)}{checked.problems.map((item, index) => <p key={`block-${index}`}>{item}</p>)}{!checked.ok && checked.problems.length === 0 && <p>Revise your objective, time period, and requested output before checking again.</p>}{checked.suggestions.map((item, index) => <p key={`suggestion-${index}`}>{item}</p>)}</div>}
      <p className="fine-print">Payment purchases admission of the research request. It does not guarantee a completed report or the accuracy of its conclusions. Your brief is sent to the IMD service.</p>
    </div><div className="imd-job-review">
      <div className="imd-wallet-heading"><h3>Your wallet</h3>{wallet && <button className="icon-btn" aria-label="Refresh wallet balance" disabled={!!busy} onClick={refreshFunds}><ArrowClockwise /></button>}</div>
      {wallet ? <><p className="imd-wallet-address">{short(wallet.address)} · Ethereum</p><dl><div><dt>IMD balance</dt><dd>{funding ? `${imdAmount(funding.balance)} IMD` : 'Reading…'}</dd></div><div><dt>Payment allowance</dt><dd>{funding && required !== null ? funding.allowance >= required ? 'Enough for this request' : 'Approval required' : 'Read after a quote'}</dd></div></dl></> : <p>Connect an Ethereum wallet to review its IMD balance and sign a research request.</p>}
      <button className="btn dark" disabled={!!busy} onClick={connect}><Wallet />{wallet ? 'Connect selected account' : 'Connect wallet'}</button>
      {quote ? <div className="imd-quote-card"><h3>Review this order</h3><dl><div><dt>Research admission</dt><dd><strong>{imdAmount(quote.payment.amount)} IMD</strong></dd></div><div><dt>Network</dt><dd>Ethereum mainnet</dd></div><div><dt>Quote expires</dt><dd>{expires(quote.expiresAt)}</dd></div><div><dt>Order</dt><dd>{short(quote.id)}</dd></div><div><dt>Recipient</dt><dd><a href={`https://etherscan.io/address/${quote.payment.payTo}`} target="_blank" rel="noopener noreferrer">{short(quote.payment.payTo)} <ArrowUpRight /></a></dd></div></dl>
        <p className="fine-print">The payment signs two approvals for this exact order and amount. An IMD token approval, when needed, is a separate Ethereum transaction with an ETH network fee.</p>
        {wallet && funding && !balanceEnough && <p className="notice">This wallet needs at least {imdAmount(quote.payment.amount)} IMD to pay for the request.</p>}
        {wallet && funding && !allowanceEnough && <><button className="btn dark" disabled={!!busy || !quoted || !balanceEnough || funding.ethBalance === 0n || !!request?.signed} onClick={approve}>Approve exactly {imdAmount(quote.payment.amount)} IMD</button>{funding.ethBalance === 0n && <p className="fine-print">Add ETH to this wallet to cover the Ethereum approval fee.</p>}</>}
        {(approvalHash || request?.approvalHash) && <p className="fine-print"><a href={`https://etherscan.io/tx/${approvalHash || request?.approvalHash}`} target="_blank" rel="noopener noreferrer">IMD approval transaction <ArrowUpRight /></a></p>}
        {!request?.signed && <button className="btn violet" disabled={!!busy || !wallet || !quoted || !balanceEnough || !allowanceEnough} onClick={pay}>Pay {imdAmount(quote.payment.amount)} IMD &amp; submit</button>}
        {expired && !request?.signed && <p className="notice">This quote expired. Start a new brief to obtain a fresh quote.</p>}
        {request?.signed && knownStatus === 'quoted' && request.signed.expiresAt > timestamp + 6 && <button className="btn violet" disabled={!!busy} onClick={retry}>Retry the same signed request</button>}
        <button className="text-btn" disabled={!!busy} onClick={() => refreshStatus()}>Check order <ArrowClockwise /></button>
      </div> : <div className="imd-quote-empty"><h3>One brief. One reviewed price.</h3><p>Check your research brief to request the current quote. Wallet signatures begin only after you choose to pay.</p>{request && <button className="text-btn" disabled={!!busy} onClick={() => refreshStatus()}>Recover this quote <ArrowClockwise /></button>}</div>}
    </div></div>
    {busy && <div className="loading" role="status"><span /> {busy}…</div>}
    {error && <div className="notice" role="alert">{error}</div>}
    {notice && <div className="notice" role="status">{notice}</div>}
    {status && <div className="imd-order-status"><h3>{status.refused ? 'Admission refused by the IMD service' : statusText[status.status] ?? 'Order status received'}</h3>{status.jobId ? <p>Job {status.jobId} has been admitted. Its report is available when the source confirms completion.</p> : <p>The saved order remains available for status checks in this browser.</p>}{status.transactionHash && <a href={`https://etherscan.io/tx/${status.transactionHash}`} target="_blank" rel="noopener noreferrer">Payment transaction <ArrowUpRight /></a>}
      {result && <div className="imd-research-result"><strong>{result.complete === true ? 'IMD reports this job as complete.' : result.state ? `Source job state: ${result.state}` : 'Research completion is not yet confirmed.'}</strong><p>Result read {new Date(result.readAt).toLocaleString('en-GB')}</p>{result.complete === true && result.files.map(file => <a key={file.hash} href={file.url} target="_blank" rel="noopener noreferrer">Open {file.name} <ArrowUpRight /></a>)}{result.complete === true && result.files.length === 0 && <p>No Markdown report is available in the confirmed file records.</p>}</div>}
    </div>}
    {request && <button className="text-btn" disabled={!!busy || unsettled} onClick={newBrief}>Start another research brief</button>}
    {records.length > 0 && <div className="imd-saved-orders"><h3>Your orders in this browser</h3><p className="fine-print">Order access is stored only in this browser. Keep these browser records to recover your submissions.</p><div>{records.map(record => <button key={record.requestKey} className="text-btn" disabled={!!busy} onClick={() => { setRequest(record); setObjective(record.input.objective); setChecked(null); setStatus(null); setResult(null); setError(''); setApprovalHash(''); if (record.order) refreshStatus(record); }}>{record.order ? `Order ${short(record.order.id)}` : 'Recover saved quote request'} <ArrowClockwise /></button>)}</div></div>}
  </section>;
}
