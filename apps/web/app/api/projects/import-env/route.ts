import { importEnvRequest, importEnvResponse, importPrototypeEnv } from '@vrt/shared';
import { NextResponse, type NextRequest } from 'next/server';
import { assertCan } from '@/lib/auth/assert-can';
import { getCurrentUser } from '@/lib/auth/session';
import { errorResponse, validationResponse } from '@/lib/http';

/** POST /api/projects/import-env (09 §1, F-PROJ-4): parses prototype `.env` text; writes nothing. */
export async function POST(request: NextRequest) {
  const body = importEnvRequest.safeParse(await request.json().catch(() => null));
  if (!body.success) return validationResponse(body.error.issues);
  try {
    await assertCan(await getCurrentUser(), 'project.create', null);
    return NextResponse.json(importEnvResponse.parse(importPrototypeEnv(body.data.text)));
  } catch (error) {
    return errorResponse(error);
  }
}
