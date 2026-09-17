import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { upload } from '../scripts/upload.mjs';
import { deletionArgs } from '../scripts/delete-report.mjs';
import { setup, fixture, keyA, origin } from './helpers.ts';

test('CLI validates and creates/updates through the Worker', async t => {
  const app = await setup(); t.after(() => app.mf.dispose());
  const dir = await mkdtemp(join(tmpdir(), 'yearn-scan-cli-')); t.after(() => rm(dir, { recursive: true }));
  const file = join(dir, 'report.json');
  const input = fixture();
  await writeFile(file, JSON.stringify(input));
  let requests = 0;
  const fetcher = (url, init) => { requests++; assert.equal(init.redirect, 'error'); return app.mf.dispatchFetch(url, { ...init, redirect: 'manual' }); };
  const env = { YEARN_SCAN_PUBLISH_KEY: keyA, YEARN_SCAN_URL: origin };
  const created = await upload(['create', file], env, fetcher);
  assert.equal(created.created, true);
  assert.equal((await upload(['create', file], env, fetcher)).created, false);
  await writeFile(file, JSON.stringify({ ...input, status: 'partial' }));
  assert.equal((await upload(['update', created.id, file], env, fetcher)).changed, true);
  const before = requests;
  await assert.rejects(() => upload(['create', file], env, async () => { requests++; return new Response('', { status: 503 }); }), /no retry/);
  assert.equal(requests, before + 1);
  for (const url of ['http://public.example', 'https://user:secret@example.com', 'https://example.com/path', 'https://example.com?key=secret']) {
    await assert.rejects(() => upload(['create', file], { ...env, YEARN_SCAN_URL: url }, fetcher), /HTTPS origin/);
  }
  await assert.rejects(() => upload(['update', '../escape', file], env, fetcher), /Usage/);
  await assert.rejects(() => upload(['create', file], {}, fetcher), /YEARN_SCAN_PUBLISH_KEY/);
  await writeFile(file, JSON.stringify({ ...input, report_url: 'javascript:alert(1)' }));
  await assert.rejects(() => upload(['create', file], env, fetcher), /report_url/);
  assert.equal(requests, before + 1, 'invalid CLI inputs never call the network');
});

test('deletion requires explicit scope and cannot inject SQL or shell arguments', () => {
  const id = crypto.randomUUID();
  const args = deletionArgs(['--local', id]);
  assert.equal(args.at(-1), `DELETE FROM reports WHERE id = '${id}'`);
  assert.ok(deletionArgs(['--remote', id, '--config', 'wrangler.production.jsonc']).includes('--remote'));
  for (const args of [[], [id], ['--remote', id], ['--local', "'; DROP TABLE reports; --"], ['--local', id, '--config'], ['--local', id, '--evil', 'true']]) {
    assert.throws(() => deletionArgs(args), /Usage/);
  }
});

test('local and production configuration disable alternate URLs', async () => {
  for (const path of ['wrangler.jsonc', 'wrangler.production.example.jsonc']) {
    const config = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(config.workers_dev, false);
    assert.equal(config.preview_urls, false);
    assert.equal(config.d1_databases.length, 1);
    assert.equal(config.r2_buckets, undefined);
  }
});
