#!/usr/bin/env node
// Local, ephemeral demonstration only. Authentication is added by this loopback
// proxy; the production Worker still validates every JWT without a bypass flag.
import { createServer } from 'node:http';
import { setup, fixture, origin } from '../test/helpers.ts';

const app = await setup();
for (const values of [
  { repository: 'yearn/tokenized-strategy', scan_type: 'ai-pr', pr_number: 241, ai_model: 'example-model', scanner: { name: 'PR review', version: '1.0' } },
  { repository: 'yearn/yearn-vaults-v3', scan_type: 'smart-contract', scanner: { name: 'Contract analysis', version: '1.0' } },
  { repository: 'yearn/tokenized-strategy', scan_type: 'dependency', scanner: { name: 'Dependency audit', version: '1.0' }, status: 'partial' },
]) await app.request('/api/v1/upload', 'POST', fixture(values));

const server = createServer(async (request, response) => {
  try {
    if (request.method !== 'GET') { response.writeHead(405); response.end(); return; }
    const result = await app.mf.dispatchFetch(`${origin}${request.url}`, {
      headers: { 'Cf-Access-Jwt-Assertion': await app.token() },
    });
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(Buffer.from(await result.arrayBuffer()));
  } catch { response.writeHead(500); response.end('Local demo error'); }
});
server.listen(8788, '127.0.0.1', () => console.log('Local demo: http://127.0.0.1:8788 (synthetic data; discarded on exit)'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  server.close(); await app.mf.dispose(); process.exit(0);
});
