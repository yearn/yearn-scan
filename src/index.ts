import type { Env } from './env.ts';
import { authenticatePublisher, authenticateReader } from './auth.ts';
import { HttpError, json, privateResponse } from './http.ts';
import { createReport, updateReport } from './reports.ts';
import { listReports } from './catalog.ts';
import html from './ui/index.html';
import css from './ui/styles.css';
import script from './ui/client.js';

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.origin !== env.APP_ORIGIN) throw new HttpError(421, 'Unrecognized origin');
  const updateMatch = /^\/api\/v1\/upload\/([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/.exec(url.pathname);
  if (url.pathname === '/api/v1/upload' || updateMatch) {
    const method = updateMatch ? 'PUT' : 'POST';
    if (request.method !== method) return json({ error: 'Method not allowed' }, 405, { Allow: method });
    const publisher = await authenticatePublisher(request, env);
    return updateMatch ? updateReport(request, env, publisher, updateMatch[1]!) : createReport(request, env, publisher);
  }
  await authenticateReader(request, env);
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405, { Allow: 'GET' });
  if (url.pathname === '/api/v1/reports') return listReports(url, env);
  if (url.pathname === '/') return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  if (url.pathname === '/styles.css') return new Response(css, { headers: { 'Content-Type': 'text/css; charset=utf-8' } });
  if (url.pathname === '/app.js') return new Response(script, { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } });
  return json({ error: 'Not found' }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try { return privateResponse(await route(request, env)); }
    catch (error) {
      if (error instanceof HttpError) return privateResponse(json({ error: error.message }, error.status));
      // Never log request bodies, keys, JWTs, or SQL errors containing metadata.
      return privateResponse(json({ error: 'Service unavailable' }, 503));
    }
  },
} satisfies ExportedHandler<Env>;
