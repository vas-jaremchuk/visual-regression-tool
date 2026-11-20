import { id } from '@vrt/shared';
import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { describeError } from '@/lib/members/errors';
import { revokeInvitation } from '@/lib/members/service';

/** DELETE /api/invitations/:id (09 §1): revokes a pending invitation. */
export async function DELETE(_request: NextRequest, ctx: RouteContext<'/api/invitations/[id]'>) {
  const invitationId = id.safeParse((await ctx.params).id);
  if (!invitationId.success) {
    return NextResponse.json(
      { error: { code: 'validation', message: 'Invalid invitation id' } },
      { status: 400 },
    );
  }
  try {
    await revokeInvitation(await getCurrentUser(), invitationId.data);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const { status, code, message } = describeError(error);
    return NextResponse.json({ error: { code, message } }, { status });
  }
}
