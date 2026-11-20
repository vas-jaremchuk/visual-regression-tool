import { sha256Hex } from '@vrt/shared';
import { describe, expect, it } from 'vitest';
import { hashInvitationToken, invitationState, inviteLink, newInvitationToken } from './token';

describe('invitation tokens', () => {
  it('are 32 random url-safe bytes stored only as their sha256', async () => {
    const a = await newInvitationToken();
    const b = await newInvitationToken();
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).toBe(await sha256Hex(a.token));
    expect(await hashInvitationToken(a.token)).toBe(a.tokenHash);
  });

  it('builds the APP_URL/invite/<token> link', () => {
    expect(inviteLink('https://vrt.example.com/', 'abc')).toBe(
      'https://vrt.example.com/invite/abc',
    );
  });
});

describe('invitationState', () => {
  const now = new Date('2026-01-08T00:00:00Z');

  it('is pending until expires_at, then expired (7-day expiry, REQ-AUTH-6)', () => {
    const createdAt = new Date('2026-01-01T00:00:00Z');
    const expiresAt = new Date(createdAt.getTime() + 7 * 24 * 3600 * 1000).toISOString();
    const invitation = { accepted_at: null, expires_at: expiresAt };
    expect(invitationState(invitation, new Date('2026-01-07T23:59:59Z'))).toBe('pending');
    expect(invitationState(invitation, now)).toBe('expired');
  });

  it('is accepted once accepted_at is set, even after expiry', () => {
    expect(
      invitationState(
        { accepted_at: '2026-01-02T00:00:00Z', expires_at: '2026-01-03T00:00:00Z' },
        now,
      ),
    ).toBe('accepted');
  });
});
