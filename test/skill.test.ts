import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { publish } from '../skills/yearn-scan/scripts/publish.mjs';
import { setup, fixture, keyA, keyB } from './helpers.ts';

test('installed publishing helper is standalone and creates, retries, and updates through the Worker', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'yearn-scan-skill-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const script = join(dir, 'publish.mjs');
  await copyFile('skills/yearn-scan/scripts/publish.mjs', script);
  const installed = await import(pathToFileURL(script).href);
  const app = await setup(); t.after(() => app.mf.dispose());
  const file = join(dir, 'submission.json');
  const input = fixture();
  await writeFile(file, JSON.stringify(input));
  const env = { YEARN_SCAN_PUBLISH_TOKEN: keyA, YEARN_SCAN_PUBLISH_KEY: keyB };
  const send = (url, options) => {
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, `Bearer ${keyA}`);
    return app.mf.dispatchFetch(url, options);
  };
  const created = await installed.publish(['create', file], env, send);
  assert.equal(created.created, true);
  const retry = await installed.publish(['create', file], env, send);
  assert.equal(retry.id, created.id);
  assert.equal(retry.created, false);
  await writeFile(file, JSON.stringify({ ...input, status: 'failed' }));
  assert.equal((await installed.publish(['update', created.id, file], env, send)).changed, true);
  assert.equal((await installed.publish(['update', created.id, file], { YEARN_SCAN_PUBLISH_KEY: keyA }, send)).changed, false);
});

test('publishing helper rejects unsafe destinations and does not retry or expose transport secrets', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'yearn-scan-skill-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'submission.json');
  await writeFile(file, JSON.stringify(fixture()));
  let calls = 0;
  const send = async () => { calls++; throw new Error(`transport detail ${keyA}`); };
  const env = { YEARN_SCAN_PUBLISH_TOKEN: keyA };
  for (const url of ['http://scan.yearn.dev', 'https://user:password@scan.yearn.dev', 'https://scan.yearn.dev/path', 'https://scan.yearn.dev/?key=value', 'https://scan.yearn.dev/#fragment']) {
    await assert.rejects(() => publish(['create', file], { ...env, YEARN_SCAN_URL: url }, send), /HTTPS origin/);
  }
  await assert.rejects(() => publish(['update', '../reports', file], env, send), /Usage/);
  await assert.rejects(() => publish(['create', file], { YEARN_SCAN_PUBLISH_TOKEN: 'invalid' }, send), /token format/);
  assert.equal(calls, 0);
  await assert.rejects(() => publish(['create', file], env, send), error => {
    assert.match(error.message, /outcome may be unknown/);
    assert.ok(!error.message.includes(keyA));
    return true;
  });
  assert.equal(calls, 1);
  await assert.rejects(() => publish(['create', file], env, async () => {
    calls++;
    return new Response(keyA, { status: 503 });
  }), /Publishing failed \(HTTP 503\); no automatic retry performed/);
  assert.equal(calls, 2);
  await writeFile(file, 'x'.repeat(16_385));
  await assert.rejects(() => publish(['create', file], env, send), /16 KiB/);
  assert.equal(calls, 2);
});
