import type { ComparisonStatus, PermissionAction, ReviewStatus } from '@vrt/shared';
import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '../auth/assert-can';
import { RequestError } from '../members/errors';
import { createReviewCommands, type ReviewGateway } from './review';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const CMP = '55555555-5555-4555-8555-555555555555';
const A = '66666666-6666-4666-8666-666666666661';
const B = '66666666-6666-4666-8666-666666666662';

function setup(options: { role?: 'editor' | 'viewer'; status?: ComparisonStatus } = {}) {
  const calls: { itemIds: string[]; review: ReviewStatus; note: string | null }[] = [];
  const authorized: PermissionAction[] = [];
  const db: ReviewGateway = {
    loadComparison: async (id) =>
      id === CMP ? { id, projectId: PROJECT, status: options.status ?? 'completed' } : null,
    reviewItems: async (_id, itemIds, review, note) => {
      calls.push({ itemIds, review, note });
      return itemIds.length;
    },
  };
  const commands = createReviewCommands({
    authorize: async (action, projectId) => {
      expect(projectId).toBe(PROJECT);
      authorized.push(action);
      if ((options.role ?? 'editor') === 'viewer') throw new ForbiddenError(action);
    },
    db,
  });
  return { commands, calls, authorized };
}

describe('review', () => {
  it('reviews the items with a trimmed note', async () => {
    const { commands, calls, authorized } = setup();
    await expect(
      commands.review(CMP, { itemIds: [A, B, A], review: 'approved', note: '  expected  ' }),
    ).resolves.toEqual({ updated: 2 });
    expect(authorized).toEqual(['comparison.review']);
    expect(calls).toEqual([{ itemIds: [A, B], review: 'approved', note: 'expected' }]);
  });

  it('stores no note when it is blank', async () => {
    const { commands, calls } = setup();
    await commands.review(CMP, { itemIds: [A], review: 'ignored', note: '   ' });
    expect(calls[0]?.note).toBeNull();
  });

  it('refuses viewers before writing', async () => {
    const { commands, calls } = setup({ role: 'viewer' });
    await expect(commands.review(CMP, { itemIds: [A], review: 'approved' })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(calls).toEqual([]);
  });

  it('is 404 for a comparison the user cannot see', async () => {
    const { commands } = setup();
    await expect(
      commands.review('55555555-5555-4555-8555-000000000000', { itemIds: [A], review: 'rejected' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it.each(['queued', 'deleting', 'delete_failed'] as const)(
    'refuses a %s comparison',
    async (status) => {
      const { commands, calls } = setup({ status });
      const error = await commands
        .review(CMP, { itemIds: [A], review: 'approved' })
        .catch((e) => e);
      expect(error).toBeInstanceOf(RequestError);
      expect(error).toMatchObject({ status: 422 });
      expect(calls).toEqual([]);
    },
  );
});
