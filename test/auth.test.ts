import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signingFixture } from './helpers.ts';
import { authenticateReader } from '../src/auth.ts';
import { issuer, audience } from './helpers.ts';

test('Access checks signatures, issuer, audience, expiry and user claims', async t => {
  const app = await setup(); t.after(() => app.mf.dispose());
  const valid = await app.token();
  const read = (token) => app.request('/api/v1/reports', 'GET', undefined, '', { 'Cf-Access-Jwt-Assertion': token });
  assert.equal((await read(valid)).status, 200, 'valid reader can access the catalog');
  for (const claims of [
    { iss: 'https://evil.cloudflareaccess.com' }, { aud: ['wrong'] }, { exp: 1 },
    { exp: undefined }, { exp: '9999999999' }, { iat: 9999999999 }, { nbf: 9999999999 },
    { type: 'service' }, { sub: '' }, { email: undefined },
  ]) assert.equal((await read(await app.token(claims))).status, 401);
  for (const header of [{ alg: 'none' }, { alg: 'HS256' }, { kid: 'unknown' }, { crit: ['unsupported'] }]) {
    assert.equal((await read(await app.token({}, header))).status, 401);
  }
  const otherSigner = await signingFixture();
  assert.equal((await read(await otherSigner.token())).status, 401);
  assert.equal((await read(valid.replace(/.$/, '!'))).status, 401);
  assert.equal((await read('malformed')).status, 401);
  assert.equal(app.outbound(), 1, 'certificates are cached and unknown kid refreshes throttled');
});

test('Access refreshes rotated signing keys and fails closed on certificate errors', async t => {
  const first = await signingFixture();
  const second = await signingFixture();
  second.jwk.kid = 'rotated-key';
  let keys = [first.jwk];
  let fetches = 0;
  t.mock.method(globalThis, 'fetch', async () => { fetches++; return Response.json({ keys }); });
  const env = { ACCESS_ISSUER: issuer, ACCESS_AUD: audience };
  const request = async signer => new Request('https://scan.yearn.dev/', { headers: { 'Cf-Access-Jwt-Assertion': await signer.token() } });
  await authenticateReader(await request(first), env);
  keys = [second.jwk];
  const now = Date.now();
  t.mock.method(Date, 'now', () => now + 31_000);
  await authenticateReader(await request(second), env);
  assert.equal(fetches, 2);
  t.mock.method(Date, 'now', () => now + 400_000);
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 503 }));
  await assert.rejects(() => request(second).then(r => authenticateReader(r, env)), /Invalid Cloudflare Access token/);
});
