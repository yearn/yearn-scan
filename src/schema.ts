import { HttpError } from './http.ts';

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
export const STATUSES = ['running', 'completed', 'failed'] as const;
export interface Submission {
  schema_version: 1;
  run_id: string;
  repository: string;
  commit_sha: string;
  ref: string | null;
  pr_number: number | null;
  pr_title?: string | null;
  pr_url?: string | null;
  scan_type: string;
  scanner: { name: string; version: string };
  ai_model: string | null;
  started_at: string;
  finished_at: string | null;
  status: typeof STATUSES[number];
  severity_counts: Record<typeof SEVERITIES[number], number | null>;
  report_url: string | null;
}

function invalid(field: string): never { throw new HttpError(400, `Invalid ${field}`); }
function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid(field);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[], field: string) {
  if (Object.keys(value).some(key => !allowed.includes(key))) invalid(`${field}: unknown field`);
}
function str(value: unknown, field: string, max: number, pattern?: RegExp): string {
  if (typeof value !== 'string' || !value.length || value.length > max || /[\u0000-\u001f\u007f]/.test(value) || (pattern && !pattern.test(value))) return invalid(field);
  return value;
}
function optionalText(value: unknown, field: string, max: number): string | null {
  return value === null || value === undefined ? null : str(value, field, max);
}
function timestamp(value: unknown, field: string): string {
  const raw = str(value, field, 24, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/);
  const millis = Date.parse(raw);
  if (!Number.isFinite(millis)) return invalid(field);
  const normalized = new Date(millis).toISOString();
  if (normalized !== (raw.length === 20 ? raw.replace('Z', '.000Z') : raw)) return invalid(field);
  return normalized;
}

function safeUrl(value: unknown, field: string): string {
  const raw = str(value, field, 4096);
  try {
    const url = new URL(raw);
    if (!raw.startsWith('https://') || /\s|\\/.test(raw) || url.protocol !== 'https:' || !url.hostname || url.username || url.password) invalid(field);
  } catch { invalid(`${field}: HTTPS URL without credentials required`); }
  return raw;
}

export function validateSubmission(input: unknown): Submission {
  const x = object(input, 'submission');
  keys(x, ['schema_version', 'run_id', 'repository', 'commit_sha', 'ref', 'pr_number', 'pr_title', 'pr_url', 'scan_type', 'scanner', 'ai_model', 'started_at', 'finished_at', 'status', 'severity_counts', 'report_url'], 'submission');
  if (x.schema_version !== 1) invalid('schema_version');
  const repository = str(x.repository, 'repository', 140, /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})\/[a-zA-Z0-9_.-]{1,100}$/).toLowerCase();
  if (['.', '..'].includes(repository.split('/')[1]!)) invalid('repository');
  const scan_type = str(x.scan_type, 'scan_type', 64, /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
  const pr_number = x.pr_number ?? null;
  if (pr_number !== null && (typeof pr_number !== 'number' || !Number.isSafeInteger(pr_number) || pr_number < 1)) invalid('pr_number');
  if (scan_type === 'ai-pr' && pr_number === null) invalid('pr_number: required for ai-pr');
  const scanner = object(x.scanner, 'scanner');
  keys(scanner, ['name', 'version'], 'scanner');
  const counts = object(x.severity_counts, 'severity_counts');
  keys(counts, SEVERITIES, 'severity_counts');
  const severity_counts = {} as Submission['severity_counts'];
  for (const severity of SEVERITIES) {
    const count = counts[severity];
    if (count !== null && (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0)) invalid(`severity_counts.${severity}`);
    severity_counts[severity] = count as number | null;
  }
  if (!STATUSES.includes(x.status as Submission['status'])) invalid('status');
  const started_at = timestamp(x.started_at, 'started_at');
  const finished_at = x.finished_at === null ? null : timestamp(x.finished_at, 'finished_at');
  if (finished_at !== null && finished_at < started_at) invalid('finished_at: precedes started_at');
  const report_url = x.report_url === null ? null : safeUrl(x.report_url, 'report_url');
  return {
    schema_version: 1,
    run_id: str(x.run_id, 'run_id', 128, /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/),
    repository,
    commit_sha: str(x.commit_sha, 'commit_sha', 40, /^[a-fA-F0-9]{40}$/).toLowerCase(),
    ref: optionalText(x.ref, 'ref', 255),
    pr_number: pr_number as number | null,
    pr_title: optionalText(x.pr_title, 'pr_title', 512),
    pr_url: x.pr_url == null ? null : safeUrl(x.pr_url, 'pr_url'),
    scan_type,
    scanner: { name: str(scanner.name, 'scanner.name', 128), version: str(scanner.version, 'scanner.version', 128) },
    ai_model: optionalText(x.ai_model, 'ai_model', 128),
    started_at, finished_at,
    status: x.status as Submission['status'],
    severity_counts, report_url,
  };
}
