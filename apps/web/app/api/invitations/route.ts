import { createInvitationRequest, createInvitationResponse } from '@vrt/shared';
import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { describeError } from '@/lib/members/errors';
import { createInvitation } from '@/lib/members/service';

/** POST /api/invitations (09 §1): project admin for a project, platform admin otherwise. */
export async function POST(request: NextRequest) {
  const body = createInvitationRequest.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      {
        error: { code: 'validation', message: 'Invalid request body', details: body.error.issues },
      },
      { status: 400 },
    );
  }
  try {
    const result = await createInvitation(await getCurrentUser(), body.data);
    return NextResponse.json(createInvitationResponse.parse(result), { status: 201 });
  } catch (error) {
    const { status, code, message } = describeError(error);
    return NextResponse.json({ error: { code, message } }, { status });
  }
}
