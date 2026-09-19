import handler from 'vinext/server/fetch-handler';
import type { Env } from './env.ts';
import { authenticateReader } from './auth.ts';
import { apiResponse, contentSecurityPolicy, HttpError, json, privateResponse } from './http.ts';

// The outer Worker protects every framework route, RSC response and asset.
// Keep this boundary outside framework routing, including HEAD/OPTIONS defaults.
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24))));
    const response = await apiResponse(async () => {
      const url = new URL(request.url);
      if (url.origin !== env.APP_ORIGIN) throw new HttpError(421, 'Unrecognized origin');
      const update = /^\/api\/v1\/upload\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(url.pathname);
      const upload = url.pathname === '/api/v1/upload' || update;
      const method = upload ? (update ? 'PUT' : 'POST') : 'GET';
      if (!upload) await authenticateReader(request, env);
      if (request.method !== method) return json({ error: 'Method not allowed' }, 405, { Allow: method });
      if (url.pathname.startsWith('/_next/static/')) return env.ASSETS.fetch(request);
      const headers = new Headers(request.headers);
      // Never trust a caller-supplied CSP nonce.
      headers.set('Content-Security-Policy', contentSecurityPolicy(nonce));
      return handler.fetch(new Request(request, { headers }), env, ctx);
    });
    return privateResponse(response, nonce);
  },
} satisfies ExportedHandler<Env>;
