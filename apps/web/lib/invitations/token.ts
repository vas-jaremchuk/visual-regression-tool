import { sha256Hex } from '@vrt/shared';

/** A one-time invitation token (04 §4): 32 random bytes, base64url. Only its sha256 is stored. */
export async function newInvitationToken(): Promise<{ token: string; tokenHash: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return { token, tokenHash: await hashInvitationToken(token) };
}

/** Lower-case hex sha256 of the token, as stored in `invitations.token_hash`. */
export function hashInvitationToken(token: string): Promise<string> {
  return sha256Hex(token);
}

export type InvitationState = 'pending' | 'accepted' | 'expired';

export function invitationState(
  invitation: { accepted_at: string | null; expires_at: string },
  now: Date = new Date(),
): InvitationState {
  if (invitation.accepted_at) return 'accepted';
  return new Date(invitation.expires_at).getTime() > now.getTime() ? 'pending' : 'expired';
}

export function inviteLink(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, '')}/invite/${token}`;
}
