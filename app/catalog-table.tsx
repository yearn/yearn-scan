'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Catalog } from '../src/catalog.ts';
import type { PublicReport } from '../src/reports.ts';

export interface Filters { q: string; scan_type: string; status: string }
const severities = ['critical', 'high', 'medium', 'low', 'info'] as const;
const scanTypes = ['ai-repo', 'ai-pr', 'dependency', 'supply-chain', 'secrets', 'static-analysis', 'smart-contract', 'infrastructure', 'domain'];
const button = 'rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium hover:bg-slate-50';
const input = 'mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal';
const detail = 'mt-1 block text-xs leading-relaxed text-slate-500 break-words';
const badge = 'inline-block rounded-md px-2 py-1 text-xs font-medium';
const statusColor = { completed: 'bg-emerald-50 text-emerald-800', partial: 'bg-amber-50 text-amber-800', failed: 'bg-red-50 text-red-800' };
const timestamp = (value: string) => value.slice(0, 19).replace('T', ' ') + ' UTC';
function queryFor(filters: Filters) {
  const query = new URLSearchParams();
  for (const key of Object.keys(filters) as (keyof Filters)[]) if (filters[key].trim()) query.set(key, filters[key].trim());
  return query;
}
function reportUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
  } catch { /* Treat corrupt stored URLs as unavailable. */ }
}

function ReportRow({ report, groupStart }: { report: PublicReport; groupStart: boolean }) {
  const href = reportUrl(report.report_url);
  return <tr className={`border-t border-slate-100 [&>td]:px-4 [&>td]:py-5 [&>td]:align-top ${groupStart ? 'border-t-2 border-t-slate-200' : ''}`}>
    <td className="max-w-64"><div className="font-semibold break-words">{report.repository}</div><span className={`${detail} font-mono`}>{report.commit_sha.slice(0, 10)}{report.pr_number ? ` · PR #${report.pr_number}` : ''}</span>{report.ref && <span className={detail}>{report.ref}</span>}</td>
    <td><span className={`${badge} bg-slate-100 text-slate-600`}>{report.scan_type}</span></td>
    <td className="max-w-56"><span className="font-medium">{report.client}</span><span className={detail}>{report.scanner.name} {report.scanner.version}</span>{report.ai_model && <span className={detail}>{report.ai_model}</span>}</td>
    <td title={`Started ${report.started_at}\nFinished ${report.finished_at}`}><span className={`${badge} status-${report.status} ${statusColor[report.status]}`}>{report.status}</span><time className={detail} dateTime={report.finished_at}>{timestamp(report.finished_at)}</time></td>
    <td><div className="flex gap-1.5">{severities.map(severity => {
      const count = report.severity_counts[severity];
      const label = `${severity}: ${count === null ? 'unavailable' : count}`;
      return <span key={severity} title={label} aria-label={label} className={`count inline-flex min-w-6 justify-center rounded px-1 py-1 font-mono text-xs ${count === null ? 'unavailable text-slate-400' : count > 0 ? 'bg-amber-50 font-semibold text-amber-900' : 'bg-slate-50 text-slate-500'}`}>{count === null ? '—' : count}</span>;
    })}</div></td>
    <td title={`Created ${report.created_at}\nUpdated ${report.updated_at}`} className="text-xs leading-relaxed text-slate-500"><time dateTime={report.updated_at}>{timestamp(report.updated_at)}</time></td>
    <td>{href ? <a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label={`Open ${report.scan_type} report for ${report.repository}`} className="whitespace-nowrap font-medium text-blue-700 hover:underline">Open report ↗</a> : 'Unavailable'}</td>
  </tr>;
}

export default function CatalogTable({ initial, initialFilters }: { initial: Catalog; initialFilters: Filters }) {
  const [data, setData] = useState<Catalog>(initial);
  const [filters, setFilters] = useState(initialFilters);
  const [active, setActive] = useState(initialFilters);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function load(nextFilters: Filters, nextPage: number, nextCursors: (string | null)[]) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); setError('');
    const query = queryFor(nextFilters);
    if (nextCursors[nextPage]) query.set('cursor', nextCursors[nextPage]!);
    try {
      const response = await fetch(`/api/v1/reports?${query}`, { headers: { Accept: 'application/json' }, cache: 'no-store', signal: controller.signal });
      if (!response.ok || !response.headers.get('Content-Type')?.includes('application/json')) throw new Error(response.status === 401 || response.status === 403 || response.redirected ? 'Your session has expired. Reload this page to sign in.' : 'Could not load scans. Try Refresh.');
      const result: Catalog = await response.json();
      if (controller.signal.aborted) return;
      setData(result); setPage(nextPage); setCursors(nextCursors); setActive(nextFilters);
      const visibleQuery = queryFor(nextFilters);
      history.replaceState(null, '', visibleQuery.size ? `/?${visibleQuery}` : '/');
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load scans.');
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }
  function apply(event?: FormEvent) {
    event?.preventDefault();
    void load(filters, 0, [null]);
  }

  return <>
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-5 sm:px-10"><a href="/" className="text-2xl font-bold tracking-tight text-blue-700">yearn<span className="ml-2 font-normal text-slate-500">scan</span></a><span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">Private catalog</span></header>
    <main className="mx-auto max-w-400 px-5 py-9 sm:px-10">
      <div className="mb-8 flex items-end justify-between gap-4"><div><p className="mb-3 text-xs font-semibold tracking-widest text-slate-500 uppercase">Security / Scan reports</p><h1 className="text-3xl font-semibold tracking-tight">Repository scans</h1><p className="mt-3 text-sm text-slate-500">One place to find the latest checks across Yearn repositories.</p></div><button className={button} type="button" disabled={busy} onClick={() => apply()}>Refresh</button></div>
      <form role="search" method="get" action="/" onSubmit={apply} className="grid items-end gap-4 rounded-xl border border-slate-200 bg-white p-5 md:grid-cols-[2fr_1fr_1fr_auto]">
        <label className="text-sm font-medium">Repository<input className={input} name="q" type="search" placeholder="Search owner/repository" maxLength={140} value={filters.q} onChange={event => setFilters({ ...filters, q: event.target.value })} /></label>
        <label className="text-sm font-medium">Scan type<input className={input} name="scan_type" list="scan-types" placeholder="All scan types" maxLength={64} value={filters.scan_type} onChange={event => setFilters({ ...filters, scan_type: event.target.value })} /><datalist id="scan-types">{scanTypes.map(type => <option key={type} value={type} />)}</datalist></label>
        <label className="text-sm font-medium">Status<select className={input} name="status" aria-label="Status" value={filters.status} onChange={event => setFilters({ ...filters, status: event.target.value })}><option value="">All statuses</option><option value="completed">Completed</option><option value="partial">Partial</option><option value="failed">Failed</option></select></label>
        <button type="submit" disabled={busy} className="rounded-lg bg-blue-700 px-5 py-3 text-sm font-medium text-white hover:bg-blue-800">Apply filters</button>
      </form>
      <div className="mt-6 mb-3 flex flex-wrap justify-between gap-2 text-xs text-slate-500"><p role="status" aria-live="polite">{busy ? 'Loading scans…' : error || `${data.reports.length} ${data.reports.length === 1 ? 'scan' : 'scans'} on this page`}</p><span>Newest repository activity first</span></div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white" aria-busy={busy}>
        <table aria-label="Repository scan reports" className="w-full min-w-275 text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{['Repository / commit', 'Scan type', 'Client / scanner', 'Execution', 'Findings', 'Latest activity', 'Report'].map(heading => <th key={heading} scope="col" className="px-4 py-4 font-medium">{heading}{heading === 'Findings' && <small className="mt-1 block text-[10px]">C / H / M / L / I</small>}</th>)}</tr></thead><tbody>{!error && data.reports.map((report, index) => <ReportRow key={report.id} report={report} groupStart={index > 0 && data.reports[index - 1]!.repository !== report.repository} />)}</tbody></table>
        {!error && !data.reports.length && <p className="p-12 text-center text-sm text-slate-500">No scans match these filters.</p>}
      </div>
      <nav aria-label="Result pages" className="mt-5 flex items-center justify-end gap-4 text-xs text-slate-500"><button type="button" className={button} disabled={busy || page === 0} onClick={() => void load(active, page - 1, cursors)}>← Previous</button><span id="page">Page {page + 1}</span><button type="button" className={button} disabled={busy || !!error || !data.next_cursor} onClick={() => void load(active, page + 1, [...cursors.slice(0, page + 1), data.next_cursor])}>Next →</button></nav>
      <p className="mt-8 text-xs leading-6 text-slate-500">C: critical · H: high · M: medium · L: low · I: info · —: unavailable.<br />Report links open the client’s hosted report and keep its access requirements.</p>
      <noscript><p className="mt-4 text-sm">Enable JavaScript for pagination and refresh. Search and filters also work by submitting this form.</p></noscript>
    </main>
  </>;
}
