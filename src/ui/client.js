const byId = id => document.getElementById(id);
const filters = byId('filters');
const rows = byId('reports');
const statusLine = byId('result-status');
const cursors = [null];
let page = 0;
let nextCursor = null;
let activeQuery = new URLSearchParams();
let currentRequest;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function render(reports) {
  rows.replaceChildren();
  let previousRepo;
  for (const report of reports) {
    const row = element('tr');
    if (previousRepo && previousRepo !== report.repository) row.className = 'repo-start';
    previousRepo = report.repository;
    const repo = element('td');
    repo.append(element('div', report.repository, 'repo'));
    repo.append(element('span', report.commit_sha.slice(0, 10) + (report.pr_number ? ` · PR #${report.pr_number}` : ''), 'detail mono'));
    if (report.ref) repo.append(element('span', report.ref, 'detail'));
    const type = element('td'); type.append(element('span', report.scan_type, 'tag'));
    const scanner = element('td', report.client);
    scanner.append(element('span', `${report.scanner.name} ${report.scanner.version}`, 'detail'));
    if (report.ai_model) scanner.append(element('span', report.ai_model, 'detail'));
    const execution = element('td');
    execution.append(element('span', report.status, `tag status-${report.status}`));
    execution.append(element('span', new Date(report.finished_at).toLocaleString(), 'detail'));
    execution.title = `Started ${report.started_at}\nFinished ${report.finished_at}`;
    const findings = element('td');
    const counts = element('div', undefined, 'counts');
    for (const severity of ['critical', 'high', 'medium', 'low', 'info']) {
      const count = report.severity_counts[severity];
      const item = element('span', count === null ? '—' : String(count), `count${count === null ? ' unavailable' : count > 0 ? ' has-findings' : ''}`);
      item.title = `${severity}: ${count === null ? 'unavailable' : count}`;
      item.setAttribute('aria-label', item.title);
      counts.append(item);
    }
    findings.append(counts);
    const activity = element('td', new Date(report.updated_at).toLocaleString());
    activity.title = `Created ${report.created_at}\nUpdated ${report.updated_at}`;
    const linkCell = element('td');
    const link = element('a', 'Open report ↗', 'report');
    // Defense in depth: never assign an unsafe URL, even if API data is corrupt.
    try {
      const url = new URL(report.report_url);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Unsafe URL');
      link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.setAttribute('aria-label', `Open ${report.scan_type} report for ${report.repository}`);
      linkCell.append(link);
    } catch { linkCell.textContent = 'Unavailable'; }
    row.append(repo, type, scanner, execution, findings, activity, linkCell);
    rows.append(row);
  }
}

async function load() {
  currentRequest?.abort();
  const controller = new AbortController();
  currentRequest = controller;
  const query = new URLSearchParams(activeQuery);
  if (cursors[page]) query.set('cursor', cursors[page]);
  byId('previous').disabled = true;
  byId('next').disabled = true;
  statusLine.textContent = 'Loading scans…';
  byId('empty').hidden = true;
  rows.replaceChildren();
  try {
    const response = await fetch(`/api/v1/reports?${query}`, { headers: { Accept: 'application/json' }, cache: 'no-store', signal: controller.signal });
    if (!response.ok || !response.headers.get('Content-Type')?.includes('application/json')) throw new Error(response.status === 401 || response.status === 403 || response.redirected ? 'Your session has expired. Reload this page to sign in.' : 'Could not load scans. Try Refresh.');
    const data = await response.json();
    if (controller.signal.aborted) return;
    render(data.reports);
    nextCursor = data.next_cursor;
    byId('empty').hidden = data.reports.length !== 0;
    statusLine.textContent = `${data.reports.length} ${data.reports.length === 1 ? 'scan' : 'scans'} on this page`;
    byId('page').textContent = `Page ${page + 1}`;
    byId('previous').disabled = page === 0;
    byId('next').disabled = !nextCursor;
  } catch (error) {
    if (controller.signal.aborted) return;
    statusLine.textContent = error instanceof Error ? error.message : 'Could not load scans.';
    byId('previous').disabled = page === 0;
  }
}

function applyFilters() {
  activeQuery = new URLSearchParams();
  for (const key of ['q', 'scan_type', 'status']) {
    const value = byId(key).value.trim();
    if (value) activeQuery.set(key, value);
  }
  history.replaceState(null, '', activeQuery.size ? `/?${activeQuery}` : '/');
  page = 0; cursors.splice(0, cursors.length, null);
  load();
}

const initial = new URLSearchParams(location.search);
for (const key of ['q', 'scan_type', 'status']) byId(key).value = initial.get(key) || '';
filters.addEventListener('submit', event => { event.preventDefault(); applyFilters(); });
byId('refresh').addEventListener('click', applyFilters);
byId('next').addEventListener('click', () => { if (nextCursor) { cursors[++page] = nextCursor; load(); } });
byId('previous').addEventListener('click', () => { if (page > 0) { page--; load(); } });
applyFilters();
