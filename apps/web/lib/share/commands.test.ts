import type { PermissionAction } from '@vrt/shared';
import { describe, expect, it } from 'vitest';
import { RequestError } from '../members/errors';
import { createShareCommands, type ShareGateway, type ShareState } from './commands';
import { hashShareToken, isShareTokenShape, newShareToken } from './token';

const CMP = '55555555-5555-4555-8555-555555555555';
const PROJECT = '11111111-1111-4111-8111-111111111111';
const LABEL = '2026-11-01_10-00-00_vs_2026-11-02_10-00-00';
const NOW = new Date('2026-11-22T10:00:00Z');

function setup(options: { role?: 'editor' | 'viewer'; visible?: boolean } = {}) {
  const state = {
    share: undefined as ShareState | null | undefined,
    audits: [] as { action: string; details: unknown }[],
    authorized: [] as PermissionAction[],
  };
  const gateway: ShareGateway = {
    loadComparison: async (id) =>
      options.visible === false || id !== CMP ? null : { id, projectId: PROJECT, label: LABEL },
    assertCan: async (action) => {
      state.authorized.push(action);
      if ((options.role ?? 'editor') === 'viewer') {
        throw new RequestError(403, 'forbidden', action);
      }
    },
    setShare: async (_id, share) => {
      state.share = share;
    },
    audit: async (action, _projectId, details) => {
      state.audits.push({ action, details });
    },
  };
  const commands = createShareCommands(gateway, {
    appUrl: 'https://vrt.example.com/',
    now: () => NOW,
  });
  return { state, commands };
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

describe('share tokens', () => {
  it('are 32 random bytes in base64url, stored as their sha256', async () => {
    const a = await newShareToken();
    const b = await newShareToken();
    expect(a.token).not.toBe(b.token);
    expect(isShareTokenShape(a.token)).toBe(true);
    expect(a.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.tokenHash).toBe(await hashShareToken(a.token));
  });

  it('rejects other shapes', () => {
    expect(isShareTokenShape('short')).toBe(false);
    expect(isShareTokenShape(`${'a'.repeat(42)}/`)).toBe(false);
  });
});

describe('createShareCommands', () => {
  it('creates a link with an expiry, stores only the hash and audits without the token', async () => {
    const { state, commands } = setup();
    const result = await commands.create(CMP, { expiresInDays: 30 });

    expect(result.expiresAt).toBe('2026-12-22T10:00:00.000Z');
    const token = result.url.replace('https://vrt.example.com/share/', '');
    expect(isShareTokenShape(token)).toBe(true);
    expect(state.share).toEqual({
      tokenHash: await hashShareToken(token),
      expiresAt: result.expiresAt,
    });
    expect(state.authorized).toEqual(['share_link.manage']);
    expect(state.audits).toEqual([
      {
        action: 'share_link.created',
        details: { comparison_id: CMP, label: LABEL, expires_at: result.expiresAt },
      },
    ]);
    expect(JSON.stringify(state.audits)).not.toContain(token);
  });

  it('revokes by clearing the hash and audits', async () => {
    const { state, commands } = setup();
    await commands.create(CMP, { expiresInDays: 1 });
    await commands.revoke(CMP);
    expect(state.share).toBeNull();
    expect(state.audits.map((a) => a.action)).toEqual(['share_link.created', 'share_link.revoked']);
  });

  it('refuses viewers', async () => {
    const { state, commands } = setup({ role: 'viewer' });
    expect(await rejection(commands.create(CMP, { expiresInDays: 30 }))).toMatchObject({
      status: 403,
    });
    expect(await rejection(commands.revoke(CMP))).toMatchObject({ status: 403 });
    expect(state.share).toBeUndefined();
    expect(state.audits).toEqual([]);
  });

  it('answers 404 for a comparison the user cannot see', async () => {
    const { state, commands } = setup({ visible: false });
    expect(await rejection(commands.create(CMP, { expiresInDays: 30 }))).toMatchObject({
      status: 404,
    });
    expect(state.authorized).toEqual([]);
  });
});
