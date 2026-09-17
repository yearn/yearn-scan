import type { Env } from './env';

export default {
  async fetch(_request: Request, _env: Env): Promise<Response> {
    return Response.json({ error: 'not_configured' }, {
      status: 503,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  },
} satisfies ExportedHandler<Env>;
