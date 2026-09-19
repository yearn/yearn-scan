import { env } from 'cloudflare:workers';
import { listReports } from '../../../../src/catalog.ts';
import { apiResponse } from '../../../../src/http.ts';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return apiResponse(() => listReports(new URL(request.url), env));
}
