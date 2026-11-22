import type { ComparisonStatus, PermissionAction, ReviewStatus } from '@vrt/shared';
import { RequestError } from '../members/errors';

/**
 * Review commands (F-REVIEW-1/2, 09 §1 `POST /api/comparisons/:id/review`). Pure orchestration
 * over `ReviewGateway`; the RPC `review_items` updates the changed items, refreshes
 * `review_counts` and writes one audit entry per call (a bulk review is one entry with the ids).
 */

export interface ReviewComparison {
  id: string;
  projectId: string;
  status: ComparisonStatus;
}

export interface ReviewGateway {
  /** The comparison (RLS: only comparisons the user can view). */
  loadComparison(comparisonId: string): Promise<ReviewComparison | null>;
  /** Calls `review_items`; returns how many items changed. */
  reviewItems(
    comparisonId: string,
    itemIds: string[],
    review: ReviewStatus,
    note: string | null,
  ): Promise<number>;
}

export interface ReviewCommandDeps {
  /** Throws unless the user may do `action` in the project (`assertCan`). */
  authorize(action: PermissionAction, projectId: string): Promise<void>;
  db: ReviewGateway;
}

export interface ReviewInput {
  itemIds: string[];
  review: ReviewStatus;
  note?: string;
}

/** Items exist once the comparison has started; they are gone or going while it is deleted. */
const REVIEWABLE: readonly ComparisonStatus[] = ['running', 'completed', 'failed', 'cancelled'];

export function createReviewCommands(deps: ReviewCommandDeps) {
  const { db } = deps;
  return {
    async review(comparisonId: string, input: ReviewInput): Promise<{ updated: number }> {
      const comparison = await db.loadComparison(comparisonId);
      if (!comparison) throw new RequestError(404, 'not_found', 'Comparison not found');
      await deps.authorize('comparison.review', comparison.projectId);
      if (!REVIEWABLE.includes(comparison.status)) {
        throw new RequestError(
          422,
          'business_rule',
          `The comparison is ${comparison.status}; its items cannot be reviewed`,
        );
      }
      const note = input.note?.trim() || null;
      const updated = await db.reviewItems(
        comparisonId,
        [...new Set(input.itemIds)],
        input.review,
        note,
      );
      return { updated };
    },
  };
}
