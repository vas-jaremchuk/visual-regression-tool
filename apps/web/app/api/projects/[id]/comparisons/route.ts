import { id, startComparisonRequest, startComparisonResponse } from '@vrt/shared';
import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { startComparison } from '@/lib/comparisons/service';
import { errorResponse, validationResponse } from '@/lib/http';

/**
 * POST /api/projects/:id/comparisons (09 §1, F-CMP-1): editor+ compares two completed runs.
 * 409 when the pair was compared already and `replace` is not set, or while it is still running.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const projectId = id.safeParse((await params).id);
  if (!projectId.success) return validationResponse(projectId.error.issues);
  const body = startComparisonRequest.safeParse(await request.json().catch(() => null));
  if (!body.success) return validationResponse(body.error.issues);
  try {
    const result = await startComparison(await getCurrentUser(), projectId.data, body.data);
    return NextResponse.json(startComparisonResponse.parse(result), { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
