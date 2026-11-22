import { emptyBody, id } from '@vrt/shared';
import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { errorResponse, validationResponse } from '@/lib/http';
import { setBaseline } from '@/lib/runs/service';

/** POST /api/runs/:id/baseline (09 §1, F-REVIEW-5): editor+ sets the project's baseline run. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const runId = id.safeParse((await params).id);
  if (!runId.success) return validationResponse(runId.error.issues);
  const body = emptyBody.safeParse(await request.json().catch(() => ({})));
  if (!body.success) return validationResponse(body.error.issues);
  try {
    await setBaseline(await getCurrentUser(), runId.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
