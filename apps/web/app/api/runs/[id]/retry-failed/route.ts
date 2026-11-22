import { emptyBody, id, workflowStartedResponse } from '@vrt/shared';
import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { errorResponse, validationResponse } from '@/lib/http';
import { limitJobStart } from '@/lib/rate-limit/service';
import { retryFailed } from '@/lib/runs/service';

/** POST /api/runs/:id/retry-failed (09 §1, 06 §4): editor+ re-captures the failed items. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const runId = id.safeParse((await params).id);
  if (!runId.success) return validationResponse(runId.error.issues);
  const body = emptyBody.safeParse(await request.json().catch(() => ({})));
  if (!body.success) return validationResponse(body.error.issues);
  try {
    const user = await getCurrentUser();
    await limitJobStart(user);
    const result = await retryFailed(user, runId.data);
    return NextResponse.json(workflowStartedResponse.parse(result), { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
