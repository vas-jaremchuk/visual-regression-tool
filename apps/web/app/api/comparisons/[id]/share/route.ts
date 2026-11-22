import { createShareRequest, emptyBody, id } from '@vrt/shared';
import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { errorResponse, validationResponse } from '@/lib/http';
import { shareCommands } from '@/lib/share/service';

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/comparisons/:id/share (09 §1, 04 §5): editor+ creates a public read-only link
 * `{expiresInDays}` → `{url, expiresAt}`, replacing any earlier link. The URL is shown only once.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const comparisonId = id.safeParse((await params).id);
  if (!comparisonId.success) return validationResponse(comparisonId.error.issues);
  const body = createShareRequest.safeParse(await request.json().catch(() => ({})));
  if (!body.success) return validationResponse(body.error.issues);
  try {
    const commands = await shareCommands(await getCurrentUser());
    return NextResponse.json(await commands.create(comparisonId.data, body.data), {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** DELETE /api/comparisons/:id/share: editor+ revokes the link; old links answer 404. */
export async function DELETE(request: NextRequest, { params }: Params) {
  const comparisonId = id.safeParse((await params).id);
  if (!comparisonId.success) return validationResponse(comparisonId.error.issues);
  const body = emptyBody.safeParse(await request.json().catch(() => ({})));
  if (!body.success) return validationResponse(body.error.issues);
  try {
    const commands = await shareCommands(await getCurrentUser());
    await commands.revoke(comparisonId.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
