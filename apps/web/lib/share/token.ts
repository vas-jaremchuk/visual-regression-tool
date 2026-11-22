import { DAY_MS, sha256Hex, SHARE_TOKEN_BYTES } from '@vrt/shared';

/** A public share token (04 §5, NFR-16): 32 random bytes, base64url. Only its sha256 is stored. */
export async function newShareToken(): Promise<{ token: string; tokenHash: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(SHARE_TOKEN_BYTES));
  const token = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return { token, tokenHash: await hashShareToken(token) };
}

/** Lower-case hex sha256 of the token, as stored in `comparisons.share_token_hash`. */
export function hashShareToken(token: string): Promise<string> {
  return sha256Hex(token);
}

/** Shape of a token `newShareToken` makes; anything else is never looked up. */
export function isShareTokenShape(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function shareLink(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, '')}/share/${token}`;
}

export function shareExpiry(expiresInDays: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + expiresInDays * DAY_MS);
}
