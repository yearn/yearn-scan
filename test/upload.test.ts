import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, fixture, keyA, keyB, origin } from './helpers.ts';
import { createReport, updateReport } from '../src/reports.ts';

test('create, ownership, canonical retries and immutable create identity', async t => {
  const app = await setup(); t.after(() => app.mf.dispose());
  const input = fixture();
  const response = await app.request('/api/v1/upload', 'POST', input);
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  const created = await response.json();
  assert.equal(created.update_url, `${origin}/api/v1/upload/${created.id}`);
  const path = `/api/v1/upload/${created.id}`;
  const retry = await app.request('/api/v1/upload', 'POST', { ...input, repository: 'YEARN/VAULTS', ref: null });
  assert.equal(retry.status, 200); assert.equal((await retry.json()).id, created.id);
  assert.equal((await app.request('/api/v1/upload', 'POST', { ...input, status: 'failed' })).status, 409);
  assert.equal((await app.request(path, 'PUT', input, keyB)).status, 404);
  assert.equal((await app.request(path, 'PUT', { ...input, run_id: 'different' })).status, 409);
  const before = await app.db.prepare('SELECT * FROM reports').first();
  const same = await (await app.request(path, 'PUT', input)).json();
  assert.equal(same.changed, false); assert.equal(same.updated_at, created.updated_at);
  const changed = await (await app.request(path, 'PUT', { ...input, repository: 'yearn/another', status: 'running' })).json();
  assert.equal(changed.changed, true); assert.ok(changed.updated_at > created.updated_at);
  assert.equal(changed.created_at, created.created_at);
  const after = await app.db.prepare('SELECT * FROM reports').first();
  assert.equal(after.owner_fingerprint, before.owner_fingerprint);
  assert.equal(after.client, 'first'); assert.equal(after.repository, 'yearn/another');
  assert.equal(after.activity_seq, before.activity_seq + 1);
  assert.equal((await app.request('/api/v1/upload', 'POST', input)).status, 200);
  assert.equal((await app.request('/api/v1/upload', 'POST', { ...input, status: 'running' })).status, 409);
  assert.equal((await app.request('/api/v1/upload', 'POST', input, keyB)).status, 201);
  assert.equal(app.outbound(), 0, 'report URLs are never fetched');
});

test('publishing authentication, revoked/replacement keys and method boundaries', async t => {
  const replacement = `first__${'c'.repeat(43)}`;
  const app = await setup({ PUBLISH_KEYS: `${replacement},${keyB}` }); t.after(() => app.mf.dispose());
  const oldId = crypto.randomUUID();
  const oldInput = fixture();
  const fingerprint = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(keyA))).toString('hex');
  await app.db.prepare('INSERT INTO reports (id, owner_fingerprint, client, run_id, create_payload, payload) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(oldId, fingerprint, 'first', oldInput.run_id, JSON.stringify(oldInput), JSON.stringify(oldInput)).run();
  assert.equal((await app.request(`/api/v1/upload/${oldId}`, 'PUT', oldInput, replacement)).status, 404, 'replacement key does not inherit ownership');
  assert.equal((await app.request(`/api/v1/upload/${oldId}`, 'PUT', oldInput, keyA)).status, 401, 'revoked owner cannot update');
  for (const key of [keyA, '', keyB.slice(0, -1), 'first__invalid']) {
    assert.equal((await app.request('/api/v1/upload', 'POST', fixture(), key)).status, 401);
  }
  assert.equal((await app.request('/api/v1/upload', 'POST', fixture(), replacement)).status, 201);
  for (const method of ['GET', 'PUT', 'DELETE', 'OPTIONS']) {
    const response = await app.request('/api/v1/upload', method);
    assert.equal(response.status, 405); assert.equal(response.headers.get('Allow'), 'POST');
  }
  assert.equal((await app.request('/api/v1/reports')).status, 401);
  assert.equal((await app.request('/')).status, 401);
  assert.equal((await app.request('/api/v1/upload/not-an-id', 'PUT', fixture())).status, 401);
  assert.equal((await app.mf.dispatchFetch('https://yearn-scan.other.workers.dev/')).status, 421);
  assert.equal((await app.mf.dispatchFetch('https://preview.yearn.dev/api/v1/upload', { method: 'POST', headers: { Authorization: `Bearer ${replacement}` } })).status, 421);
});

test('mutation code calls a failing D1 batch exactly once', async () => {
  for (const operation of [createReport, updateReport]) {
    let calls = 0;
    const statement = { bind() { return this; } };
    const env = { DB: { prepare() { return statement; }, async batch() { calls++; throw new Error('injected'); } } };
    const request = new Request(`${origin}/api/v1/upload`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fixture()) });
    await assert.rejects(() => operation(request, env, { client: 'test', fingerprint: 'test' }, crypto.randomUUID()), /injected/);
    assert.equal(calls, 1);
  }
});

test('schema rejects invalid and unsafe submissions before writes', async t => {
  const app = await setup(); t.after(() => app.mf.dispose());
  for (const override of [
    { schema_version: 2 }, { run_id: '' }, { repository: '../evil' }, { commit_sha: 'abcd' },
    { scan_type: 'ai-pr' }, { scan_type: 'AI' }, { pr_number: 0 }, { extra: true },
    { scanner: { name: '', version: '1' } }, { status: 'done' }, { status: 'partial' }, { pr_title: '' }, { pr_title: 1 }, { pr_url: 'javascript:alert(1)' }, { pr_url: 'https://u:p@example.com' },
    { started_at: '2026-02-30T10:00:00Z' }, { finished_at: '2026-09-15T10:00:00Z' },
    { severity_counts: { critical: 0 } }, { severity_counts: { ...fixture().severity_counts, info: -1 } },
    ...['javascript:alert(1)', 'http://example.com', 'https://u:p@example.com', 'https:\\example.com', ' https://example.com', 'https://example.com/\n'].map(report_url => ({ report_url })),
  ]) {
    assert.equal((await app.request('/api/v1/upload', 'POST', fixture(override))).status, 400, JSON.stringify(override));
  }
  const body = JSON.stringify(fixture());
  assert.equal((await app.mf.dispatchFetch(`${origin}/api/v1/upload`, { method: 'POST', headers: { Authorization: `Bearer ${keyA}` }, body })).status, 415);
  assert.equal((await app.mf.dispatchFetch(`${origin}/api/v1/upload`, { method: 'POST', headers: { Authorization: `Bearer ${keyA}`, 'Content-Type': 'application/json' }, body: '{' })).status, 400);
  assert.equal((await app.request('/api/v1/upload', 'POST', fixture({ ref: 'x'.repeat(17_000) }))).status, 413);
  assert.equal((await app.db.prepare('SELECT COUNT(*) AS n FROM reports').first()).n, 0);
  assert.equal((await app.request('/api/v1/upload', 'POST', fixture({ scan_type: 'custom-scanner', severity_counts: { critical: null, high: null, medium: null, low: null, info: null } }))).status, 201);
});

test('concurrent creates and updates remain atomic and idempotent', async t => {
  const app = await setup(); t.after(() => app.mf.dispose());
  const input = fixture();
  const responses = await Promise.all(Array.from({ length: 12 }, () => app.request('/api/v1/upload', 'POST', input)));
  assert.equal(responses.filter(x => x.status === 201).length, 1);
  assert.equal(responses.filter(x => x.status === 200).length, 11);
  const bodies = await Promise.all(responses.map(x => x.json()));
  assert.equal(new Set(bodies.map(x => x.id)).size, 1);
  const path = `/api/v1/upload/${bodies[0].id}`;
  const updates = await Promise.all(Array.from({ length: 12 }, () => app.request(path, 'PUT', { ...input, status: 'running' }).then(x => x.json())));
  assert.equal(updates.filter(x => x.changed).length, 1);
  assert.equal((await app.db.prepare('SELECT sequence FROM activity_clock').first()).sequence, 2);
  const conflict = fixture();
  const results = await Promise.all(['failed', 'completed'].map(status => app.request('/api/v1/upload', 'POST', { ...conflict, status })));
  assert.deepEqual(results.map(x => x.status).sort(), [201, 409]);
});

test('database errors roll back the mutation and do not retry', async t => {
  const app = await setup(); t.after(() => app.mf.dispose());
  await app.db.prepare("CREATE TRIGGER fail_clock BEFORE UPDATE ON activity_clock BEGIN SELECT RAISE(ABORT, 'injected failure'); END").run();
  assert.equal((await app.request('/api/v1/upload', 'POST', fixture())).status, 503);
  assert.equal((await app.db.prepare('SELECT COUNT(*) AS n FROM reports').first()).n, 0);
  assert.equal((await app.db.prepare('SELECT sequence FROM activity_clock').first()).sequence, 0);
  await app.db.prepare('DROP TRIGGER fail_clock').run();
  const input = fixture();
  const created = await (await app.request('/api/v1/upload', 'POST', input)).json();
  const before = await app.db.prepare('SELECT * FROM reports').first();
  await app.db.prepare("CREATE TRIGGER fail_clock BEFORE UPDATE ON activity_clock BEGIN SELECT RAISE(ABORT, 'injected failure'); END").run();
  assert.equal((await app.request(`/api/v1/upload/${created.id}`, 'PUT', { ...input, status: 'failed' })).status, 503);
  assert.deepEqual(await app.db.prepare('SELECT * FROM reports').first(), before);
});

test('loopback aliases work locally without weakening authentication or production origins', async t => {
  const local = await setup({ APP_ORIGIN: 'http://127.0.0.1:3000' });
  t.after(() => local.mf.dispose());
  const headers = { 'Cf-Access-Jwt-Assertion': await local.token() };
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    const url = `http://${host}:3000/api/v1/reports`;
    assert.equal((await local.mf.dispatchFetch(url, { headers })).status, 200);
    assert.equal((await local.mf.dispatchFetch(url)).status, 401, 'aliases still require Access');
  }
  for (const url of ['http://localhost:3001', 'https://localhost:3000', 'http://localhost.example:3000', 'http://192.168.1.2:3000']) {
    assert.equal((await local.mf.dispatchFetch(`${url}/api/v1/reports`, { headers })).status, 421, url);
  }
  const production = await setup();
  t.after(() => production.mf.dispose());
  const productionHeaders = { 'Cf-Access-Jwt-Assertion': await production.token() };
  for (const url of ['http://localhost:3000', 'http://127.0.0.1:3000', 'https://localhost', 'https://preview.yearn.dev']) {
    assert.equal((await production.mf.dispatchFetch(`${url}/api/v1/reports`, { headers: productionHeaders })).status, 421, url);
  }
});


test('running and nullable results accept PR metadata without state-dependent requirements', async t => {
  const app = await setup(); t.after(() => app.mf.dispose());
  const input = fixture({ status: 'running', finished_at: null, report_url: null,
    pr_title: '<b>Fix accounting</b>', pr_url: 'https://github.com/yearn/vaults/pull/42', pr_number: 42,
    severity_counts: { critical: null, high: null, medium: null, low: null, info: null } });
  const response = await app.request('/api/v1/upload', 'POST', input);
  assert.equal(response.status, 201);
  const { id } = await response.json();
  for (const status of ['completed', 'failed', 'running']) {
    assert.equal((await app.request(`/api/v1/upload/${id}`, 'PUT', { ...input, status })).status, 200);
  }
  const read = await app.request('/api/v1/reports', 'GET', undefined, '', { 'Cf-Access-Jwt-Assertion': await app.token() });
  const { reports } = await read.json();
  assert.equal(reports[0].pr_title, input.pr_title);
  assert.equal(reports[0].pr_url, input.pr_url);
  assert.equal(reports[0].finished_at, null);
  assert.equal(reports[0].report_url, null);
  assert.equal((await app.request(`/api/v1/upload/${id}`, 'PUT', { ...input, status: 'running', finished_at: fixture().finished_at, report_url: fixture().report_url })).status, 200);
});
