import { emptyBody, id, rediffResponse } from '@vrt/shared';
import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { rediffComparison } from '@/lib/comparisons/service';
import { errorResponse, validationResponse } from '@/lib/http';

/**
 * POST /api/comparisons/:id/rediff (09 §1, F-IGNORE-3): editor+ re-runs a finished comparison
 * with the project's current thresholds and ignore rules. 409 while it is still running.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const comparisonId = id.safeParse((await params).id);
  if (!comparisonId.success) return validationResponse(comparisonId.error.issues);
  const body = emptyBody.safeParse((await request.json().catch(() => null)) ?? {});
  if (!body.success) return validationResponse(body.error.issues);
  try {
    const result = await rediffComparison(await getCurrentUser(), comparisonId.data);
    return NextResponse.json(rediffResponse.parse(result), { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
