#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export async function publish(args, env = process.env, fetcher = fetch) {
  const [operation, first, second, ...rest] = args;
  const update = operation === 'update';
  const file = update ? second : first;
  if (!['create', 'update'].includes(operation) || !file || rest.length
    || (!update && second)
    || (update && !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(first))) {
    throw new Error('Usage: publish.mjs create FILE.json | update REPORT_ID FILE.json');
  }
  const token = env.YEARN_SCAN_PUBLISH_TOKEN || env.YEARN_SCAN_PUBLISH_KEY;
  if (!token) throw new Error('Set YEARN_SCAN_PUBLISH_TOKEN to the full clientname--apikey token');
  const separator = token.indexOf('--');
  if (separator < 1 || !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/.test(token.slice(0, separator))
    || !/^[a-zA-Z0-9_-]{32,256}$/.test(token.slice(separator + 2))) {
    throw new Error('Invalid publishing token format; expected clientname--apikey');
  }
  let origin;
  try {
    origin = new URL(env.YEARN_SCAN_URL || 'https://scan.yearn.dev');
    if (origin.protocol !== 'https:' || origin.username || origin.password
      || origin.pathname !== '/' || origin.search || origin.hash) throw new Error();
  } catch { throw new Error('YEARN_SCAN_URL must be an HTTPS origin without credentials, path, query, or fragment'); }
  const bytes = await readFile(file);
  if (bytes.length > 16_384) throw new Error('Submission exceeds 16 KiB');
  let input;
  try { input = JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error('Submission is not valid JSON'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Submission must be a JSON object');
  // The API validates the complete schema. Send unchanged metadata so retries
  // preserve the original create payload and run ID.
  let response;
  try {
    response = await fetcher(`${origin.origin}/api/v1/upload${update ? `/${first}` : ''}`, {
      method: update ? 'PUT' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: bytes, redirect: 'error', signal: AbortSignal.timeout(30_000),
    });
  } catch { throw new Error('Request failed; outcome may be unknown. No automatic retry performed. Preserve the original payload and run_id.'); }
  if (!response.ok) throw new Error(`Publishing failed (HTTP ${response.status}); no automatic retry performed`);
  return response.json();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await publish(process.argv.slice(2)), null, 2)); }
  catch (error) { console.error(error instanceof Error ? error.message : 'Publishing failed'); process.exitCode = 1; }
}
