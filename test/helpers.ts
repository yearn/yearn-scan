import { Miniflare } from 'miniflare';
import { readFile, readdir } from 'node:fs/promises';

export const origin = 'https://scan.yearn.dev';
export const keyA = `first__${'a'.repeat(43)}`;
export const keyB = `second__${'b'.repeat(43)}`;
export const issuer = 'https://test.cloudflareaccess.com';
export const audience = 'test-audience';
export const fixture = (overrides = {}) => ({
  schema_version: 1, run_id: crypto.randomUUID(), repository: 'yearn/vaults',
  commit_sha: 'a'.repeat(40), scan_type: 'ai-repo',
  scanner: { name: 'scanner', version: '1.0' },
  started_at: '2026-09-16T10:00:00Z', finished_at: '2026-09-16T10:01:00Z',
  status: 'completed', severity_counts: { critical: 0, high: 1, medium: 2, low: 0, info: null },
  report_url: 'https://reports.example/private/scan.html', ...overrides,
});

export async function signingFixture() {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };
  async function token(claims = {}, header = {}) {
    const now = Math.floor(Date.now() / 1000);
    const encode = (x) => Buffer.from(JSON.stringify(x)).toString('base64url');
    const message = `${encode({ alg: 'RS256', kid: jwk.kid, ...header })}.${encode({ iss: issuer, aud: [audience], iat: now - 1, exp: now + 300, type: 'app', sub: 'user', email: 'reader@example.com', ...claims })}`;
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(message));
    return `${message}.${Buffer.from(signature).toString('base64url')}`;
  }
  return { jwk, token };
}

export async function setup(options = {}) {
  const signing = await signingFixture();
  const config = JSON.parse(await readFile('dist/server/wrangler.json', 'utf8'));
  let outbound = 0;
  const files = (await readdir('dist/server', { recursive: true })).filter(file => file.endsWith('.js') && file !== 'index.js');
  const mf = new Miniflare({
    modules: ['index.js', ...files].map(file => ({ type: 'ESModule', path: `dist/server/${file}` })),
    modulesRoot: 'dist/server', compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
    assets: { directory: 'dist/client', binding: 'ASSETS', routerConfig: { has_user_worker: true, invoke_user_worker_ahead_of_assets: config.assets.run_worker_first } },
    bindings: { APP_ORIGIN: origin, ACCESS_ISSUER: issuer, ACCESS_AUD: audience, PUBLISH_KEYS: `${keyA},${keyB}`, ...options },
    d1Databases: ['DB'],
    outboundService: async (request) => {
      outbound++;
      if (request.url !== `${issuer}/cdn-cgi/access/certs`) throw new Error('Unexpected outbound request');
      return Response.json({ keys: [signing.jwk] });
    },
  });
  try {
    const db = await mf.getD1Database('DB');
    const migration = await readFile('migrations/0001_reports.sql', 'utf8');
    const statements = migration.split(/;(?=\s*(?:CREATE|INSERT|$))/).map(x => x.trim()).filter(Boolean);
    await db.batch(statements.map(x => db.prepare(x)));
    const request = (path, method = 'GET', body?, key = keyA, headers = {}) => mf.dispatchFetch(`${origin}${path}`, {
      method, headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { mf, db, request, ...signing, outbound: () => outbound };
  } catch (error) { await mf.dispose(); throw error; }
}
