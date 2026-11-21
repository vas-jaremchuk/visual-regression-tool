import { emptyBody, id } from '@vrt/shared';
import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { errorResponse, validationResponse } from '@/lib/http';
import { cancelRun } from '@/lib/runs/service';

/** POST /api/runs/:id/cancel (09 §1, F-RUN-4): editor+ cancels a queued or running run. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const runId = id.safeParse((await params).id);
  if (!runId.success) return validationResponse(runId.error.issues);
  const body = emptyBody.safeParse(await request.json().catch(() => ({})));
  if (!body.success) return validationResponse(body.error.issues);
  try {
    await cancelRun(await getCurrentUser(), runId.data);
    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
