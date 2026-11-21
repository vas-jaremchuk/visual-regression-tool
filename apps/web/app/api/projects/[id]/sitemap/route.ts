import { emptyBody, id, startSitemapResponse } from '@vrt/shared';
import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { errorResponse, validationResponse } from '@/lib/http';
import { startSnapshot } from '@/lib/sitemap/service';

/** POST /api/projects/:id/sitemap (09 §1, F-SITEMAP-1): editor+ starts a sitemap snapshot. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const projectId = id.safeParse((await params).id);
  if (!projectId.success) return validationResponse(projectId.error.issues);
  const body = emptyBody.safeParse(await request.json().catch(() => ({})));
  if (!body.success) return validationResponse(body.error.issues);
  try {
    const result = await startSnapshot(await getCurrentUser(), projectId.data);
    return NextResponse.json(startSitemapResponse.parse(result), { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
