import { useCallback, useEffect, useRef, useState } from 'react';

export const IMD = '0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7';
export type Envelope<T> = { kind: string; source: string; fetchedAt: string; data: T };
export type Pair = { id: string; dex: string | null; name: string; quote: string | null; priceUsd: number | null; liquidityUsd: number | null; volume24h: number | null; change24h: number | null; buys24h: number | null; sells24h: number | null; url: string | null };
export type Market = { pairs: Pair[] };
export type Swarm = { online: number | null; working: number | null; accepted24h: number | null; seats: number | null; workers: { tokenId: string | null; agentId: string | null; working: boolean | null; skills: string[]; lastSeenAt: string | null }[] };
export type Seat = { tokenId: string; agentId: string | null; owner: string | null; online: boolean | null; attempts: number | null; accepted: number | null; rejected: number | null; failed: number | null; pending: number | null; lastWorkedAt: string | null; work: { jobId: string | null; objective: string | null; status: string | null; submittedAt: string | null }[] };
export type Artifact = { name: string | null; hash: string | null; url: string | null; bytes: number | null; mediaType: string | null };
export type Publication = { id: string; jobId: string | null; objective: string; type: string | null; state: string | null; deliveredAt: string | null; repoUrl: string | null; siteUrl: string | null; commit: string | null; files: Artifact[]; chains: number[] };
export type Publications = { count: number; totalPages: number; page: number; items: Publication[] };
export type Job = { id: string; state: string | null; complete: boolean | null; files: Artifact[] };

export function publishedWorkAllowed(item: Pick<Publication, 'objective' | 'chains'>): boolean {
  return item.chains.every(chain => chain === 1) && !/\b(?:demo|demonstration|testnet|prototype|sandbox|simulation|mock)\b/i.test(item.objective);
}

export async function read<T>(kind: string, params: Record<string, string> = {}, signal?: AbortSignal): Promise<Envelope<T>> {
  const response = await fetch(`/api/data?${new URLSearchParams({ kind, ...params })}`, { signal });
  const payload = await response.json();
  if (!response.ok) throw new Error(typeof payload.message === 'string' ? payload.message : 'The source is unavailable. Please try again.');
  if (payload.kind !== kind || !payload.data || !Number.isFinite(Date.parse(payload.fetchedAt))) throw new Error('The source returned an unreadable response.');
  return payload;
}

export function useData<T>(kind: string, params: Record<string, string> = {}) {
  const [snapshot, setSnapshot] = useState<Envelope<T> | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const query = new URLSearchParams(params).toString();
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    // Clear records immediately when the query changes, so another query's data cannot appear as current.
    Promise.resolve().then(() => { if (active) { setLoading(true); setError(''); setSnapshot(null); } });
    read<T>(kind, Object.fromEntries(new URLSearchParams(query)), controller.signal)
      .then(value => { if (active) setSnapshot(value); })
      .catch(reason => { if (active && !controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'The source is unavailable.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [kind, query, revision]);
  return { snapshot, error, loading, refresh };
}

export function safeLink(value: string | null | undefined): string | null {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export function money(value: number | null | undefined, precise = false) {
  return value == null || !Number.isFinite(value) ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: precise ? 6 : 0, minimumFractionDigits: precise ? 2 : 0 }).format(value);
}
export function count(value: number | null | undefined) { return value == null ? '—' : new Intl.NumberFormat('en-US').format(value); }
export function short(value: string | null | undefined) { return value ? `${value.slice(0, 7)}…${value.slice(-5)}` : 'Unavailable'; }
export function time(value: string | null | undefined) { return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : 'Unavailable'; }
export function download(name: string, contents: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  // Spreadsheet programs can interpret formula-like cells, even in quoted CSV.
  return `"${(/^[=+\-@\t\r]/.test(text) ? "'" : '') + text.replace(/"/g, '""')}"`;
}
export async function sha256(file: File): Promise<string> {
  if (file.size > 64 * 1024 * 1024) throw new Error('Choose a file smaller than 64 MB.');
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}
export function useCopy() {
  const [copied, setCopied] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); setCopied(value); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setCopied(''), 2000); } catch { setCopied('failed'); }
  };
  return { copied, copy };
}
