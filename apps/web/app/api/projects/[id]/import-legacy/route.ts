import { id, importLegacyRequest, importLegacyResponse } from '@vrt/shared';
import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { errorResponse, validationResponse } from '@/lib/http';
import { limitJobStart } from '@/lib/rate-limit/service';
import { importLegacyLabels, listLegacyLabels } from '@/lib/legacy/service';

/**
 * POST /api/projects/:id/import-legacy (09 §1, F-RUN-6): project admin lists the bucket's
 * prototype runs not yet imported (`list`), or imports a selection of them (`import`, 202).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const projectId = id.safeParse((await params).id);
  if (!projectId.success) return validationResponse(projectId.error.issues);
  const body = importLegacyRequest.safeParse(await request.json().catch(() => null));
  if (!body.success) return validationResponse(body.error.issues);
  try {
    const user = await getCurrentUser();
    if (body.data.action === 'list') {
      return NextResponse.json(
        importLegacyResponse.parse(await listLegacyLabels(user, projectId.data)),
      );
    }
    await limitJobStart(user);
    const result = await importLegacyLabels(user, projectId.data, body.data.labels);
    return NextResponse.json(importLegacyResponse.parse(result), { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
