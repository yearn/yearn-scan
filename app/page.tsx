import { env } from 'cloudflare:workers';
import { getReports } from '../src/catalog.ts';
import { HttpError } from '../src/http.ts';
import CatalogTable, { type Filters } from './catalog-table';

export const dynamic = 'force-dynamic';
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const filters: Filters = { q: '', scan_type: '', status: '' };
  const url = new URL(env.APP_ORIGIN);
  for (const key of Object.keys(filters) as (keyof Filters)[]) {
    const value = params[key];
    filters[key] = (Array.isArray(value) ? value[0] : value) || '';
    if (filters[key]) url.searchParams.set(key, filters[key]);
  }
  // The outer Worker authenticates before any render or D1 read. This page is
  // always dynamic: no shared page cache, ISR, prerendering or internal fetch.
  try {
    const initial = await getReports(url, env);
    return <CatalogTable initial={initial} initialFilters={filters} />;
  } catch (error) {
    return <main className="mx-auto max-w-7xl p-8"><h1 className="text-3xl font-bold">Repository scans</h1><p role="alert" className="my-6">{error instanceof HttpError ? error.message : 'Could not load scans. Please reload this page.'}</p><a className="text-blue-700 underline" href="/">Clear filters and reload</a></main>;
  }
}
