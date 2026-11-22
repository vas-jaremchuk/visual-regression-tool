import { id, startRunRequest, startRunResponse } from '@vrt/shared';
import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { errorResponse, validationResponse } from '@/lib/http';
import { startRun } from '@/lib/runs/service';

/**
 * POST /api/projects/:id/runs (09 §1, F-RUN-1/2/5): editor+ starts a capture run, or lists its
 * items without capturing (`dryRun`). 409 with the active run when one is queued or running.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const projectId = id.safeParse((await params).id);
  if (!projectId.success) return validationResponse(projectId.error.issues);
  const body = startRunRequest.safeParse(await request.json().catch(() => null));
  if (!body.success) return validationResponse(body.error.issues);
  try {
    const result = await startRun(await getCurrentUser(), projectId.data, body.data);
    return NextResponse.json(startRunResponse.parse(result), {
      status: result.dryRun ? 200 : 202,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
