#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function deletionArgs(args) {
  const [scope, id, flag, config, ...rest] = args;
  if (!['--local', '--remote'].includes(scope) || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id || '') || rest.length || (flag && (flag !== '--config' || !config)) || (!flag && config) || (scope === '--remote' && !config)) {
    throw new Error('Usage: pnpm delete-report --local ID [--config FILE] | pnpm delete-report --remote ID --config FILE');
  }
  return ['exec', 'wrangler', 'd1', 'execute', 'DB', scope, ...(config ? ['--config', config] : []), '--command', `DELETE FROM reports WHERE id = '${id}'`];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = spawnSync('pnpm', deletionArgs(process.argv.slice(2)), { stdio: 'inherit', shell: false });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } catch (error) { console.error(error instanceof Error ? error.message : 'Deletion failed'); process.exitCode = 1; }
}
