import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, fixture } from './helpers.ts';

test('catalog groups repository activity, filters and pages without omissions', async t => {
  const app = await setup(); t.after(() => app.mf.dispose());
  const headers = { 'Cf-Access-Jwt-Assertion': await app.token() };
  const read = async query => {
    const response = await app.request(`/api/v1/reports?${query}`, 'GET', undefined, '', headers);
    assert.equal(response.status, 200); return response.json();
  };
  const inputs = [fixture({ repository: 'yearn/a', scan_type: 'ai-pr', pr_number: 12 }), fixture({ repository: 'yearn/b', status: 'failed' }), fixture({ repository: 'yearn/a', scan_type: 'custom-type' }), fixture({ repository: 'yearn/c', status: 'running', finished_at: null, report_url: null })];
  const ids = [];
  for (const input of inputs) ids.push((await (await app.request('/api/v1/upload', 'POST', input)).json()).id);
  const all = await read('');
  assert.deepEqual(all.reports.map(x => x.id), [ids[3], ids[2], ids[0], ids[1]]);
  assert.deepEqual(all.repositories, ['yearn/a', 'yearn/b', 'yearn/c']);
  assert.deepEqual((await read('q=missing&limit=1')).repositories, all.repositories);
  assert.equal((await read('status=running')).reports[0].finished_at, null);
  assert.equal((await read('status=running')).reports[0].report_url, null);
  assert.equal(all.reports[0].severity_counts.info, null);
  assert.equal(all.reports[0].severity_counts.critical, 0);
  assert.equal(all.reports[0].owner_fingerprint, undefined);
  assert.equal(all.reports[0].create_payload, undefined);
  assert.equal((await read('q=YEARN%2FA')).reports.length, 2);
  assert.equal((await read('q=%25')).reports.length, 0, 'wildcards searched literally');
  assert.equal((await read("q='OR%201=1--")).reports.length, 0);
  assert.deepEqual((await read('status=failed')).reports.map(x => x.id), [ids[1]]);
  assert.deepEqual((await read('scan_type=ai-pr')).reports.map(x => x.id), [ids[0]]);
  assert.equal((await read('q=yearn&scan_type=custom-type&status=completed')).reports.length, 1);
  let cursor = null;
  const paged = [];
  do {
    const response = await read(`limit=1${cursor ? `&cursor=${cursor}` : ''}`);
    paged.push(...response.reports.map(x => x.id));
    cursor = response.next_cursor;
  } while (cursor);
  assert.deepEqual(paged, all.reports.map(x => x.id));
  const first = await read('limit=1');
  for (const query of ['limit=0', 'limit=101', 'limit=1.5', 'status=wrong', 'status=partial', 'q=x&q=y', 'unknown=1', 'cursor=bad', `limit=1&status=failed&cursor=${first.next_cursor}`]) {
    assert.equal((await app.request(`/api/v1/reports?${query}`, 'GET', undefined, '', headers)).status, 400, query);
  }
  await app.request(`/api/v1/upload/${ids[1]}`, 'PUT', { ...inputs[1], status: 'completed' });
  assert.deepEqual((await read('')).reports.map(x => x.id), [ids[1], ids[3], ids[2], ids[0]]);
  await app.request(`/api/v1/upload/${ids[0]}`, 'PUT', inputs[0]);
  assert.equal((await read('')).reports[0].id, ids[1], 'unchanged PUT does not move a repository');
});

test('HTML, scripts and styles are private and submitted text stays inert', async t => {
  const app = await setup(); t.after(() => app.mf.dispose());
  const headers = { 'Cf-Access-Jwt-Assertion': await app.token() };
  const hostile = '<img src=x onerror=alert(1)>';
  await app.request('/api/v1/upload', 'POST', fixture({ scanner: { name: hostile, version: '</script><script>alert(1)</script>' }, ref: hostile }));
  const catalog = await (await app.request('/api/v1/reports', 'GET', undefined, '', headers)).json();
  assert.equal(catalog.reports[0].scanner.name, hostile);
  const html = await (await app.request('/', 'GET', undefined, '', headers)).text();
  const assets = [...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)].map(match => match[1]);
  assert.ok(assets.length > 0, 'SSR document references built assets');
  assert.ok(html.includes('yearn/vaults'), 'initial data is server rendered');
  for (const path of ['/', '/yearn-symbol.svg', ...assets]) {
    assert.equal((await app.request(path)).status, 401);
    const response = await app.request(path, 'GET', undefined, '', headers);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.match(response.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
    assert.ok(!(await response.text()).includes(hostile));
  }
  assert.equal((await app.request('/api/v1/reports', 'POST', {}, '', headers)).status, 405);
});

test('SSR and RSC stay private, uncached and reflect accepted updates', async t => {
  const app = await setup(); t.after(() => app.mf.dispose());
  const headers = { 'Cf-Access-Jwt-Assertion': await app.token() };
  const input = fixture({ repository: 'yearn/ssr-test', scanner: { name: 'Original scanner', version: '1.0' } });
  const { id } = await (await app.request('/api/v1/upload', 'POST', input)).json();
  const read = (path = '/', extra = {}) => app.request(path, 'GET', undefined, '', { ...headers, ...extra });
  const first = await read('/', { 'Content-Security-Policy': "script-src 'nonce-attacker'" });
  const firstHtml = await first.text();
  assert.ok(firstHtml.includes('Original scanner'));
  assert.ok(!firstHtml.includes('owner_fingerprint'));
  const nonce = first.headers.get('Content-Security-Policy').match(/'nonce-([^']+)'/)[1];
  assert.notEqual(nonce, 'attacker');
  assert.ok(firstHtml.includes(`nonce="${nonce}"`), 'SSR scripts use server nonce');
  assert.ok(!first.headers.get('Content-Security-Policy').includes('unsafe-inline'));
  for (const path of ['/?_rsc=test', '/api/v1/reports', '/missing', '/_next/static/missing.js', '/api/v1/upload/not-a-uuid', '/api/v1/upload/']) {
    assert.equal((await app.request(path, 'GET', undefined, undefined, { RSC: '1' })).status, 401, path);
  }
  for (const method of ['HEAD', 'OPTIONS', 'POST']) {
    assert.equal((await app.request('/', method, undefined, '', headers)).status, 405);
    assert.equal((await app.request('/api/v1/reports', method, undefined, '', headers)).status, 405);
  }
  const rsc = await read('/?_rsc=test', { RSC: '1' });
  assert.equal(rsc.status, 200);
  assert.match(rsc.headers.get('Content-Type'), /text\/x-component/);
  assert.equal(rsc.headers.get('Cache-Control'), 'private, no-store');
  assert.ok((await rsc.text()).includes('Original scanner'));
  await app.request(`/api/v1/upload/${id}`, 'PUT', { ...input, scanner: { name: 'Changed scanner', version: '2.0' } });
  const next = await read();
  assert.notEqual(next.headers.get('Content-Security-Policy'), first.headers.get('Content-Security-Policy'));
  const nextHtml = await next.text();
  assert.ok(nextHtml.includes('Changed scanner'));
  assert.ok(!nextHtml.includes('Original scanner'));
  assert.ok(!(await (await read('/?q=missing')).text()).includes('Changed scanner'));
  assert.equal((await app.mf.dispatchFetch('https://alternate.example/?_rsc=test', { headers: { ...headers, RSC: '1' } })).status, 421);
});
