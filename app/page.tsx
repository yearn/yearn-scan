import { env } from 'cloudflare:workers';
import { getReports } from '../src/catalog.ts';
import { HttpError } from '../src/http.ts';
import CatalogTable, { type Filters } from './catalog-table';

export const dynamic = 'force-dynamic';
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const filters: Filters = { q: '', scan_type: '', status: '', limit: '' };
  const url = new URL(env.APP_ORIGIN);
  for (const key of Object.keys(filters) as (keyof Filters)[]) {
    const value = params[key];
    filters[key] = (Array.isArray(value) ? value[0] : value) || '';
    if (filters[key]) url.searchParams.set(key, filters[key]);
  }
  const cursor = Array.isArray(params.cursor) ? params.cursor[0] : params.cursor;
  if (cursor) url.searchParams.set('cursor', cursor);
  // The outer Worker authenticates before any render or D1 read. This page is
  // always dynamic: no shared page cache, ISR, prerendering or internal fetch.
  try {
    const initial = await getReports(url, env);
    return <CatalogTable initial={initial} initialFilters={filters} initialCursor={cursor || null} initialNow={Date.now()} />;
  } catch (error) {
    return <CatalogTable initialFilters={filters} initialError={error instanceof HttpError ? error.message : 'Could not load scans.'} />;
  }
}
