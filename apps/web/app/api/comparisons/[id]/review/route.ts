import { id, reviewRequest, reviewResponse } from '@vrt/shared';
import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { reviewItems } from '@/lib/comparisons/service';
import { errorResponse, validationResponse } from '@/lib/http';

/**
 * POST /api/comparisons/:id/review (09 §1, F-REVIEW-1/2): editor+ approves, rejects, ignores or
 * resets changed items, one or a filtered selection. The RPC `review_items` writes the audit.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const comparisonId = id.safeParse((await params).id);
  if (!comparisonId.success) return validationResponse(comparisonId.error.issues);
  const body = reviewRequest.safeParse(await request.json().catch(() => null));
  if (!body.success) return validationResponse(body.error.issues);
  try {
    const result = await reviewItems(await getCurrentUser(), comparisonId.data, body.data);
    return NextResponse.json(reviewResponse.parse(result));
  } catch (error) {
    return errorResponse(error);
  }
}
