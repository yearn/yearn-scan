import type { Publisher } from './auth.ts';
import { HttpError, json, readJson } from './http.ts';
import { validateSubmission } from './schema.ts';
import type { Submission } from './schema.ts';
import type { Env } from './env.ts';

export interface ReportRow {
  id: string; client: string; run_id: string; payload: string;
  create_payload: string; created_at: number; updated_at: number; activity_seq: number;
}

export type PublicReport = Submission & { id: string; client: string; created_at: string; updated_at: string };

export function publicReport(row: ReportRow): PublicReport {
  return { ...JSON.parse(row.payload), id: row.id, client: row.client,
    created_at: new Date(row.created_at).toISOString(), updated_at: new Date(row.updated_at).toISOString() };
}

export async function createReport(request: Request, env: Env, publisher: Publisher): Promise<Response> {
  const input = validateSubmission(await readJson(request));
  const payload = JSON.stringify(input);
  const id = crypto.randomUUID();
  const results = await env.DB.batch<ReportRow>([
    env.DB.prepare(`INSERT INTO reports (id, owner_fingerprint, client, run_id, create_payload, payload)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(owner_fingerprint, run_id) DO NOTHING`)
      .bind(id, publisher.fingerprint, publisher.client, input.run_id, payload, payload),
    env.DB.prepare('SELECT * FROM reports WHERE owner_fingerprint = ? AND run_id = ?').bind(publisher.fingerprint, input.run_id),
  ]);
  const row = results[1]?.results[0];
  if (!row) throw new Error('Missing create result');
  if (row.create_payload !== payload) throw new HttpError(409, 'run_id already used with a different create payload');
  const created = row.id === id;
  const update_url = `${env.APP_ORIGIN}/api/v1/upload/${row.id}`;
  return json({ id: row.id, update_url, created, created_at: new Date(row.created_at).toISOString(), updated_at: new Date(row.updated_at).toISOString() }, created ? 201 : 200, { Location: update_url });
}

export async function updateReport(request: Request, env: Env, publisher: Publisher, id: string): Promise<Response> {
  const input = validateSubmission(await readJson(request));
  const payload = JSON.stringify(input);
  const results = await env.DB.batch<ReportRow>([
    env.DB.prepare('UPDATE reports SET payload = ? WHERE id = ? AND owner_fingerprint = ? AND run_id = ? AND payload <> ?')
      .bind(payload, id, publisher.fingerprint, input.run_id, payload),
    env.DB.prepare('SELECT * FROM reports WHERE id = ? AND owner_fingerprint = ?').bind(id, publisher.fingerprint),
  ]);
  const row = results[1]?.results[0];
  if (!row) throw new HttpError(404, 'Report not found');
  if (row.run_id !== input.run_id) throw new HttpError(409, 'run_id cannot be changed');
  return json({ id: row.id, update_url: `${env.APP_ORIGIN}/api/v1/upload/${row.id}`, changed: (results[0]?.meta.changes ?? 0) > 0,
    created_at: new Date(row.created_at).toISOString(), updated_at: new Date(row.updated_at).toISOString() });
}
