import { deleteRunQuery, id } from '@vrt/shared';
import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { errorResponse, validationResponse } from '@/lib/http';
import { deleteRun } from '@/lib/storage/service';

/**
 * DELETE /api/runs/:id (09 §1, F-RUN-4): project admin. Without `?confirm=true` answers what would
 * be deleted; with it starts the DeleteWorkflow (202). Deleting a `delete_failed` run retries.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const runId = id.safeParse((await params).id);
  if (!runId.success) return validationResponse(runId.error.issues);
  const confirm = deleteRunQuery.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  ).success;
  try {
    const preview = await deleteRun(await getCurrentUser(), runId.data, confirm);
    return NextResponse.json(preview, { status: confirm ? 202 : 200 });
  } catch (error) {
    return errorResponse(error);
  }
}
