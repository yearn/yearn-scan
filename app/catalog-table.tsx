'use client';

import { useEffect, useRef, useState } from 'react';
import type { Catalog } from '../src/catalog.ts';
import type { PublicReport } from '../src/reports.ts';

export interface Filters { q: string; scan_type: string; status: string; limit?: string }
const severities = ['critical', 'high', 'medium', 'low', 'info'] as const;
const scanNames: Record<string, string> = {
  'ai-repo': 'AI repository review', 'ai-pr': 'AI PR review', dependency: 'Dependencies',
  'supply-chain': 'Supply chain', secrets: 'Secrets', 'static-analysis': 'Static analysis',
  'smart-contract': 'Smart contracts', infrastructure: 'Infrastructure', domain: 'Domain',
};
const empty: Catalog = { schema_version: 1, repositories: [], reports: [], next_cursor: null };
function queryFor(filters: Filters) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value?.trim()) query.set(key, value.trim());
  return query;
}
function safeLink(raw: string | null | undefined): string | undefined {
  if (!raw || !raw.startsWith('https://') || /\s|\\/.test(raw)) return;
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
  } catch { /* Treat corrupt stored URLs as unavailable. */ }
}
function relativeTime(value: string, now: number) {
  const seconds = Math.round((Date.parse(value) - now) / 1000);
  const format = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [unit, size] of [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]] as const) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(seconds, 'second');
}
function Status({ report }: { report: PublicReport }) {
  const highest = severities.find(key => (report.severity_counts[key] ?? 0) > 0);
  const known = severities.every(key => report.severity_counts[key] === 0);
  const state = report.status === 'running' || report.status === 'failed' ? report.status
    : report.status === 'completed' ? highest || (known ? 'clear' : 'unknown') : 'unknown';
  const description = state === 'running' ? 'Running' : state === 'failed' ? 'Failed'
    : highest ? `Completed: highest reported severity ${highest}` : known ? 'Completed: no findings' : 'Completed: findings unavailable';
  return <span role="img" aria-label={description} title={description} className={`status-indicator status-${state}`}>
    {state === 'running' ? <span className="spinner" /> : <span aria-hidden="true">{state === 'failed' ? '×' : state === 'clear' ? '✓' : state === 'unknown' ? '—' : null}</span>}
  </span>;
}
function ReportRow({ report, now }: { report: PublicReport; now: number }) {
  const href = safeLink(report.report_url);
  const prHref = safeLink(report.pr_url);
  const name = scanNames[report.scan_type] || report.scan_type.replaceAll('-', ' ');
  const time = report.status === 'running' ? report.started_at : report.finished_at || report.updated_at;
  const [owner, repository] = report.repository.split('/');
  const pr = [report.pr_number ? `#${report.pr_number}` : '', report.pr_title].filter(Boolean).join(' · ');
  return <tr className="report-row">
    <td><div className="repository"><span className="owner">{owner} / </span>{repository}</div>{(pr || prHref) && <div className="pr-metadata">{prHref ? <a href={prHref} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{pr || 'Pull request'} ↗</a> : pr}</div>}</td>
    <td>{name}</td>
    <td className="client-column">{report.client}</td>
    <td className="time-column"><time dateTime={time} title={time}>{relativeTime(time, now)}</time></td>
    <td><div className="findings">{severities.map(severity => {
      const count = report.severity_counts[severity];
      const label = `${severity === 'info' ? 'informational' : severity}: ${count === null ? 'unavailable' : count}`;
      return <span key={severity} title={label} aria-label={label} className={`count severity-${severity}${count === null ? ' unavailable' : count > 0 ? ' positive' : ''}`}>{count === null ? '—' : count}</span>;
    })}</div></td>
    <td><Status report={report} /></td>
    <td>{href ? <a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label={`Open ${name} report for ${report.repository}`} className="report-link">Report ↗</a> : <span className="unavailable" aria-label="Report unavailable">—</span>}</td>
  </tr>;
}

export default function CatalogTable({ initial = empty, initialFilters = { q: '', scan_type: '', status: '' }, initialCursor = null, initialError = '', initialLoading = false, initialNow = Date.now() }: {
  initial?: Catalog; initialFilters?: Filters; initialCursor?: string | null; initialError?: string; initialLoading?: boolean; initialNow?: number;
}) {
  const [data, setData] = useState(initial);
  const [filters, setFilters] = useState(initialFilters);
  const [cursors, setCursors] = useState<(string | null)[]>([initialCursor]);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(initialLoading);
  const [error, setError] = useState(initialError);
  const [now, setNow] = useState(initialNow);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function load(nextFilters: Filters, nextPage: number, nextCursors: (string | null)[], background = false) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (!background) {
      setBusy(true); setFilters(nextFilters); setPage(nextPage); setCursors(nextCursors);
    }
    setError('');
    const query = queryFor(nextFilters);
    if (nextCursors[nextPage]) query.set('cursor', nextCursors[nextPage]!);
    if (!background) history.replaceState(null, '', query.size ? `/?${query}` : '/');
    try {
      const response = await fetch(`/api/v1/reports?${query}`, { headers: { Accept: 'application/json' }, cache: 'no-store', signal: controller.signal });
      if (!response.ok || !response.headers.get('Content-Type')?.includes('application/json')) throw new Error(response.status === 401 || response.status === 403 || response.redirected ? 'Your session has expired.' : 'Could not load scans.');
      const result: Catalog = await response.json();
      if (controller.signal.aborted) return;
      setData(result); setNow(Date.now());
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : 'Could not load scans.');
        if (!background) setData(current => ({ ...current, reports: [], next_cursor: null }));
      }
    } finally {
      if (!controller.signal.aborted) { setBusy(false); request.current = null; }
    }
  }
  const hasRunning = data.reports.some(report => report.status === 'running');
  useEffect(() => {
    if (!hasRunning || busy) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    function schedule() {
      clearInterval(timer);
      if (document.visibilityState === 'visible') timer = setInterval(() => {
        if (!request.current) void load(filters, page, cursors, true);
      }, 15_000);
    }
    schedule();
    document.addEventListener('visibilitychange', schedule);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', schedule); };
  }, [hasRunning, busy, filters, page, cursors]);
  function filter(next: Filters) { void load(next, 0, [null]); }
  const repositories = filters.q && !data.repositories.includes(filters.q) ? [filters.q, ...data.repositories] : data.repositories;

  return <>
    <header className="catalog-header">
      <a href="/" className="brand" aria-label="Yearn Scan home"><img src="/yearn-symbol.svg" alt="Yearn" width="40" height="47" /></a>
      <label className="filter"><span>repo</span><select aria-label="Repository" value={filters.q} onChange={event => filter({ ...filters, q: event.target.value })}><option value="">all repositories</option>{repositories.map(repository => <option key={repository} value={repository}>{repository.replace('/', ' / ')}</option>)}</select></label>
      <label className="filter status-filter"><span>status</span><select aria-label="Status" value={filters.status} onChange={event => filter({ ...filters, status: event.target.value })}><option value="">all statuses</option><option value="running">running</option><option value="completed">completed</option><option value="failed">failed</option></select></label>
    </header>
    <main aria-label="Repository scans">
      <div className="table-area" aria-busy={busy}>
        <div className="table-scroll" role="region" aria-label="Scan results" tabIndex={0}>
          <table aria-label="Repository scan reports"><thead><tr>{['repo', 'scan', 'client', 'time', 'findings', 'status', 'report'].map(heading => <th key={heading} scope="col" className={heading === 'client' ? 'client-column' : undefined}>{heading}</th>)}</tr></thead>
            <tbody>{busy ? Array.from({ length: 5 }, (_, row) => <tr key={row} className="skeleton-row" aria-hidden="true">{Array.from({ length: 7 }, (_, column) => <td key={column} className={column === 2 ? 'client-column' : undefined}><span className={`skeleton skeleton-${column}`} /></td>)}</tr>) : <>
              {data.reports.map(report => <ReportRow key={report.id} report={report} now={now} />)}
              {error ? <tr><td colSpan={7} className="table-message"><span role="alert">{error} <a href={initialError ? '/' : `/?${queryFor(filters)}`}  className="recovery" tabIndex={0}>Reload{initialError ? ' and clear filters' : ''}</a></span></td></tr> : !data.reports.length && <tr><td colSpan={7} className="table-message">No scans match these filters.</td></tr>}
            </>}</tbody>
          </table>
        </div>
        <span className="sr-only" role="status" aria-live="polite">{busy ? 'Loading scans…' : `${data.reports.length} scans on this page`}</span>
        {(page > 0 || cursors[0] || data.next_cursor) && <nav aria-label="Result pages"><button type="button" disabled={busy || (page === 0 && !cursors[0])} onClick={() => void load(filters, Math.max(0, page - 1), page === 0 ? [null] : cursors)}>← Previous</button><button type="button" disabled={busy || !!error || !data.next_cursor} onClick={() => void load(filters, page + 1, [...cursors.slice(0, page + 1), data.next_cursor])}>Next →</button></nav>}
      </div>
    </main>
  </>;
}
