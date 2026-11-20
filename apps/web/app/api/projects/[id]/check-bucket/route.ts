import { checkBucketRequest, checkBucketResponse, id } from '@vrt/shared';
import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { errorResponse, validationResponse } from '@/lib/http';
import { runBucketCheck } from '@/lib/projects/service';

/** POST /api/projects/:id/check-bucket (09 §1, F-PROJ-5): project admin. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const projectId = id.safeParse((await params).id);
  if (!projectId.success) return validationResponse(projectId.error.issues);
  const body = checkBucketRequest.safeParse(await request.json().catch(() => ({})));
  if (!body.success) return validationResponse(body.error.issues);
  try {
    const result = await runBucketCheck(await getCurrentUser(), projectId.data, body.data.create);
    return NextResponse.json(checkBucketResponse.parse(result));
  } catch (error) {
    return errorResponse(error);
  }
}
