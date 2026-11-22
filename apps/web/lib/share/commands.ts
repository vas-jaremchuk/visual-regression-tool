import type { Json } from '@vrt/db';
import type { PermissionAction } from '@vrt/shared';
import { RequestError } from '../members/errors';
import { newShareToken, shareExpiry, shareLink } from './token';

/**
 * Public share links (04 §5, REQ-AUTH-7). Pure orchestration over `ShareGateway`; `service.ts`
 * wires it to Supabase. Only the token's sha256 is stored, so the link is shown once, on create.
 */

export interface ShareComparison {
  id: string;
  projectId: string;
  label: string;
}

export interface ShareState {
  tokenHash: string;
  expiresAt: string;
}

export interface ShareGateway {
  /** The comparison (RLS: only comparisons the user can view). */
  loadComparison(comparisonId: string): Promise<ShareComparison | null>;
  assertCan(action: PermissionAction, projectId: string): Promise<void>;
  /** Sets the link, or clears it (`null`) so old links stop resolving. */
  setShare(comparisonId: string, share: ShareState | null): Promise<void>;
  audit(action: string, projectId: string, details: Record<string, Json>): Promise<void>;
}

export interface ShareDeps {
  appUrl: string;
  now?: () => Date;
  newToken?: typeof newShareToken;
}

export function createShareCommands(gateway: ShareGateway, deps: ShareDeps) {
  const now = deps.now ?? (() => new Date());
  const newToken = deps.newToken ?? newShareToken;

  async function load(comparisonId: string): Promise<ShareComparison> {
    const comparison = await gateway.loadComparison(comparisonId);
    if (!comparison) throw new RequestError(404, 'not_found', 'Comparison not found');
    await gateway.assertCan('share_link.manage', comparison.projectId);
    return comparison;
  }

  return {
    /** Creates a link, replacing any earlier one (the old link stops working). */
    async create(
      comparisonId: string,
      input: { expiresInDays: number },
    ): Promise<{ url: string; expiresAt: string }> {
      const comparison = await load(comparisonId);
      const { token, tokenHash } = await newToken();
      const expiresAt = shareExpiry(input.expiresInDays, now()).toISOString();
      await gateway.setShare(comparison.id, { tokenHash, expiresAt });
      await gateway.audit('share_link.created', comparison.projectId, {
        comparison_id: comparison.id,
        label: comparison.label,
        expires_at: expiresAt,
      });
      return { url: shareLink(deps.appUrl, token), expiresAt };
    },

    async revoke(comparisonId: string): Promise<void> {
      const comparison = await load(comparisonId);
      await gateway.setShare(comparison.id, null);
      await gateway.audit('share_link.revoked', comparison.projectId, {
        comparison_id: comparison.id,
        label: comparison.label,
      });
    },
  };
}
