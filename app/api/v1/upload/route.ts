import { env } from 'cloudflare:workers';
import { authenticatePublisher } from '../../../../src/auth.ts';
import { apiResponse } from '../../../../src/http.ts';
import { createReport } from '../../../../src/reports.ts';

export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  return apiResponse(async () => createReport(request, env, await authenticatePublisher(request, env)));
}
