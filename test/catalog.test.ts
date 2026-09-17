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
  const inputs = [fixture({ repository: 'yearn/a', scan_type: 'ai-pr', pr_number: 12 }), fixture({ repository: 'yearn/b', status: 'failed' }), fixture({ repository: 'yearn/a', scan_type: 'custom-type' }), fixture({ repository: 'yearn/c', status: 'partial' })];
  const ids = [];
  for (const input of inputs) ids.push((await (await app.request('/api/v1/upload', 'POST', input)).json()).id);
  const all = await read('');
  assert.deepEqual(all.reports.map(x => x.id), [ids[3], ids[2], ids[0], ids[1]]);
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
  for (const query of ['limit=0', 'limit=101', 'limit=1.5', 'status=wrong', 'q=x&q=y', 'unknown=1', 'cursor=bad', `limit=1&status=failed&cursor=${first.next_cursor}`]) {
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
  for (const path of ['/', '/app.js', '/styles.css']) {
    assert.equal((await app.request(path)).status, 401);
    const response = await app.request(path, 'GET', undefined, '', headers);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.match(response.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
    assert.ok(!(await response.text()).includes(hostile));
  }
  assert.equal((await app.request('/api/v1/reports', 'POST', {}, '', headers)).status, 405);
});
