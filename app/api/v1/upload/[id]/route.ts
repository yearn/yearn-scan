import { env } from 'cloudflare:workers';
import { authenticatePublisher } from '../../../../../src/auth.ts';
import { apiResponse } from '../../../../../src/http.ts';
import { updateReport } from '../../../../../src/reports.ts';

export const dynamic = 'force-dynamic';
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return apiResponse(async () => updateReport(request, env, await authenticatePublisher(request, env), (await params).id));
}
