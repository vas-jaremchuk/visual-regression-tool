import { emptyBody, id } from '@vrt/shared';
import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { errorResponse, validationResponse } from '@/lib/http';
import { refreshStorage } from '@/lib/storage/service';

/** POST /api/projects/:id/storage/refresh (09 §1, F-STORAGE-1): project admin. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const projectId = id.safeParse((await params).id);
  if (!projectId.success) return validationResponse(projectId.error.issues);
  const body = emptyBody.safeParse(await request.json().catch(() => ({})));
  if (!body.success) return validationResponse(body.error.issues);
  try {
    return NextResponse.json(await refreshStorage(await getCurrentUser(), projectId.data), {
      status: 202,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
