import { digest, hex } from './auth.ts';
import type { Env } from './env.ts';
import { HttpError, json } from './http.ts';
import { publicReport } from './reports.ts';
import type { ReportRow } from './reports.ts';
import { STATUSES } from './schema.ts';

interface CatalogRow extends ReportRow { repository: string; repo_seq: number }
interface Cursor { v: number; query: string; repo_seq: number; repository: string; seq: number; id: string }
const fail = (): never => { throw new HttpError(400, 'Invalid query or cursor'); };

export interface Catalog { schema_version: 1; repositories: string[]; reports: ReturnType<typeof publicReport>[]; next_cursor: string | null }

export async function listReports(url: URL, env: Env): Promise<Response> {
  return json(await getReports(url, env));
}

export async function getReports(url: URL, env: Env): Promise<Catalog> {
  const params = url.searchParams;
  for (const key of params.keys()) if (!['q', 'scan_type', 'status', 'limit', 'cursor'].includes(key) || params.getAll(key).length !== 1) fail();
  const q = (params.get('q') || '').trim().toLowerCase();
  const scanType = params.get('scan_type') || '';
  const status = params.get('status') || '';
  const limitText = params.get('limit') || '50';
  if (q.length > 140 || /[\u0000-\u001f\u007f]/.test(q) || (scanType && !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(scanType)) || scanType.length > 64 || (status && !STATUSES.includes(status as typeof STATUSES[number])) || !/^\d{1,3}$/.test(limitText)) fail();
  const limit = Number(limitText);
  if (limit < 1 || limit > 100) fail();
  const query = hex(await digest(JSON.stringify([q, scanType, status, limit])));
  let cursor: Cursor | null = null;
  const encoded = params.get('cursor');
  if (encoded) {
    try {
      if (encoded.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(encoded)) fail();
      cursor = JSON.parse(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')));
      if (!cursor || cursor.v !== 1 || cursor.query !== query || !Number.isSafeInteger(cursor.repo_seq) || cursor.repo_seq < 1 || !Number.isSafeInteger(cursor.seq) || cursor.seq < 1 || typeof cursor.repository !== 'string' || !/^[a-z0-9-]+\/[a-z0-9_.-]+$/.test(cursor.repository) || cursor.repository.length > 140 || typeof cursor.id !== 'string' || !/^[a-f0-9-]{36}$/.test(cursor.id)) fail();
    } catch { fail(); }
  }
  const values: (string | number)[] = [];
  const conditions: string[] = [];
  if (q) { conditions.push("r.repository LIKE ? ESCAPE '\\'"); values.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`); }
  if (scanType) { conditions.push('r.scan_type = ?'); values.push(scanType); }
  if (status) { conditions.push('r.status = ?'); values.push(status); }
  if (cursor) {
    conditions.push(`(a.repo_seq < ? OR (a.repo_seq = ? AND (r.repository > ? OR
      (r.repository = ? AND (r.activity_seq < ? OR (r.activity_seq = ? AND r.id < ?))))))`);
    values.push(cursor.repo_seq, cursor.repo_seq, cursor.repository, cursor.repository, cursor.seq, cursor.seq, cursor.id);
  }
  values.push(limit + 1);
  const result = await env.DB.prepare(`WITH activity AS (
      SELECT repository, MAX(activity_seq) AS repo_seq FROM reports GROUP BY repository
    ) SELECT r.*, a.repo_seq FROM reports r JOIN activity a ON a.repository = r.repository
    ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
    ORDER BY a.repo_seq DESC, r.repository ASC, r.activity_seq DESC, r.id DESC LIMIT ?`).bind(...values).all<CatalogRow>();
  const repositories = await env.DB.prepare('SELECT DISTINCT repository FROM reports ORDER BY repository ASC').all<{ repository: string }>();
  const rows = result.results.slice(0, limit);
  const last = rows.at(-1);
  const nextCursor = result.results.length > limit && last
    ? btoa(JSON.stringify({ v: 1, query, repo_seq: last.repo_seq, repository: last.repository, seq: last.activity_seq, id: last.id })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
    : null;
  return { schema_version: 1, repositories: repositories.results.map(row => row.repository), reports: rows.map(publicReport), next_cursor: nextCursor };
}
