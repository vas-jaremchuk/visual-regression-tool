import { deleteRunQuery, id } from '@vrt/shared';
import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { errorResponse, validationResponse } from '@/lib/http';
import { deleteComparison } from '@/lib/storage/service';

/**
 * DELETE /api/comparisons/:id (F-STORAGE-3): project admin. Same contract as deleting a run:
 * preview without `?confirm=true`, DeleteWorkflow (202) with it.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const comparisonId = id.safeParse((await params).id);
  if (!comparisonId.success) return validationResponse(comparisonId.error.issues);
  const confirm = deleteRunQuery.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  ).success;
  try {
    const preview = await deleteComparison(await getCurrentUser(), comparisonId.data, confirm);
    return NextResponse.json(preview, { status: confirm ? 202 : 200 });
  } catch (error) {
    return errorResponse(error);
  }
}
