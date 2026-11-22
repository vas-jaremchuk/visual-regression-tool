import { reviewStatus } from '@vrt/shared';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { errorResponse, validationResponse } from '@/lib/http';
import { RequestError } from '@/lib/members/errors';
import { fetchSharedItemPage } from '@/lib/share/service';

const itemsQuery = z.object({
  status: z
    .enum(['compared', 'changed', 'unchanged', 'new', 'missing', 'redirect', 'error'])
    .default('changed'),
  viewport: z.string().min(1).max(64).optional(),
  review: reviewStatus.optional(),
  search: z.string().max(500).default(''),
  maxPct: z.coerce.number().min(0).max(100).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

/**
 * GET /api/share/:token/items (04 §5): the next page of the shared report's list, for viewers
 * without a session. Only items of the comparison the token resolves to; 404 once revoked/expired.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const query = itemsQuery.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!query.success) return validationResponse(query.error.issues);
  const { offset, viewport, review, maxPct, ...rest } = query.data;
  try {
    const page = await fetchSharedItemPage(
      (await params).token,
      { ...rest, viewport: viewport ?? null, review: review ?? null, maxPct: maxPct ?? null },
      offset,
    );
    if (!page) throw new RequestError(404, 'not_found', 'Share link not found');
    return NextResponse.json(page, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
