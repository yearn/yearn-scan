#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { validateSubmission } from '../src/schema.ts';

export async function upload(args, env = process.env, fetcher = fetch) {
  const [operation, first, second, ...rest] = args;
  const id = operation === 'update' ? first : null;
  const file = operation === 'create' ? first : second;
  if (!['create', 'update'].includes(operation) || !file || rest.length || (operation === 'create' && second) || (id && !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id))) {
    throw new Error('Usage: pnpm upload create FILE.json | pnpm upload update ID FILE.json');
  }
  const key = env.YEARN_SCAN_PUBLISH_KEY;
  if (!key) throw new Error('Set YEARN_SCAN_PUBLISH_KEY to the complete clientname__apikey entry');
  let origin;
  try {
    origin = new URL(env.YEARN_SCAN_URL || 'https://scan.yearn.dev');
    if ((origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error();
  } catch { throw new Error('YEARN_SCAN_URL must be an HTTPS origin (HTTP allowed only for loopback development)'); }
  const bytes = await readFile(file);
  if (bytes.length > 16_384) throw new Error('Metadata file exceeds 16 KiB');
  let input;
  try { input = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('Metadata file is not valid JSON'); }
  const body = JSON.stringify(validateSubmission(input));
  // Never follow redirects with a publishing key or retry ambiguous failures.
  const response = await fetcher(`${origin.origin}/api/v1/upload${id ? `/${id}` : ''}`, {
    method: id ? 'PUT' : 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body, redirect: 'error', signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Upload failed (HTTP ${response.status}); no retry performed`);
  return response.json();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await upload(process.argv.slice(2)), null, 2)); }
  catch (error) { console.error(error instanceof Error ? error.message : 'Upload failed'); process.exitCode = 1; }
}
