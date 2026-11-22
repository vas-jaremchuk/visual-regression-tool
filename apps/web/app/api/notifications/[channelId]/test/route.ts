import { emptyBody, id } from '@vrt/shared';
import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { errorResponse, validationResponse } from '@/lib/http';
import { testChannel } from '@/lib/notifications/service';

/** POST /api/notifications/:channelId/test (09 §1, F-NOTIFY-2): project admin sends a test. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ channelId: string }> },
) {
  const channelId = id.safeParse((await params).channelId);
  if (!channelId.success) return validationResponse(channelId.error.issues);
  const body = emptyBody.safeParse(await request.json().catch(() => ({})));
  if (!body.success) return validationResponse(body.error.issues);
  try {
    return NextResponse.json(await testChannel(await getCurrentUser(), channelId.data));
  } catch (error) {
    return errorResponse(error);
  }
}
