import { id } from '@vrt/shared';
import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { exportComparison } from '@/lib/comparisons/export-service';
import { errorResponse, validationResponse } from '@/lib/http';
import { RequestError } from '@/lib/members/errors';

/**
 * GET /api/comparisons/:id/export.html (F-CMP-8): viewer+ downloads the static report, the same
 * document the workflow exports to R2, also for projects without a public URL.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const comparisonId = id.safeParse((await params).id);
  if (!comparisonId.success) return validationResponse(comparisonId.error.issues);
  try {
    const user = await getCurrentUser();
    if (!user) throw new RequestError(401, 'unauthorized', 'Sign in to download the report');
    const { filename, html } = await exportComparison(user, comparisonId.data);
    return new NextResponse(html, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'private, no-store',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
