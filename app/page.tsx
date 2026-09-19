import { env } from 'cloudflare:workers';
import { getReports } from '../src/catalog.ts';

export const dynamic = 'force-dynamic';
export default async function Page() {
  const data = await getReports(new URL(env.APP_ORIGIN), env);
  return <main className="mx-auto max-w-7xl p-8"><h1 className="text-3xl font-bold">Yearn Scan</h1><ul>{data.reports.map(report => <li key={report.id}>{report.repository} — {report.scanner.name}</li>)}</ul></main>;
}
