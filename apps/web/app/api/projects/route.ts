import { createProjectRequest, createProjectResponse } from '@vrt/shared';
import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { errorResponse, validationResponse } from '@/lib/http';
import { createProject } from '@/lib/projects/service';

/** POST /api/projects (09 §1, F-PROJ-1): platform admin; creates the default viewport. */
export async function POST(request: NextRequest) {
  const body = createProjectRequest.safeParse(await request.json().catch(() => null));
  if (!body.success) return validationResponse(body.error.issues);
  try {
    const result = await createProject(await getCurrentUser(), body.data);
    return NextResponse.json(createProjectResponse.parse(result), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
