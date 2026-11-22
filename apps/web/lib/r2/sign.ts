import { SIGNED_URL_TTL_MS, type PermissionAction } from '@vrt/shared';
import { keyBelongsToComparison } from '../comparisons/report';
import { RequestError } from '../members/errors';
import { isShareTokenShape } from '../share/token';

/**
 * GET /api/r2/sign (09 §1): a short-lived signed GET URL for an object of a comparison the user
 * can view. Pure orchestration over `SignGateway`; `service.ts` wires it to Supabase and R2.
 */

export interface SignComparison {
  id: string;
  projectId: string;
  label: string;
  beforeLabel: string;
  afterLabel: string;
  /** The project's own bucket: keys are always resolved in it, never in another project's. */
  bucket: string;
}

export interface SignGateway {
  /** The comparison with its runs and bucket (RLS: only comparisons the user can view). */
  loadComparison(comparisonId: string): Promise<SignComparison | null>;
  assertCan(action: PermissionAction, projectId: string): Promise<void>;
  presignGet(bucket: string, key: string, expiresInSeconds: number): Promise<string>;
}

export const SIGN_TTL_SECONDS = SIGNED_URL_TTL_MS / 1000;

export async function signComparisonObject(
  gateway: SignGateway,
  input: { comparisonId: string; key: string },
  now: () => number = Date.now,
): Promise<{ url: string; expiresAt: string }> {
  const comparison = await gateway.loadComparison(input.comparisonId);
  if (!comparison) throw new RequestError(404, 'not_found', 'Comparison not found');
  await gateway.assertCan('project.view', comparison.projectId);
  if (!keyBelongsToComparison(input.key, comparison)) {
    throw new RequestError(403, 'forbidden', 'The key does not belong to this comparison');
  }
  const url = await gateway.presignGet(comparison.bucket, input.key, SIGN_TTL_SECONDS);
  return { url, expiresAt: new Date(now() + SIGN_TTL_SECONDS * 1000).toISOString() };
}

export interface SharedSignGateway {
  /** The comparison id a live share token resolves to (`resolve_share_token`), else null. */
  resolveShareToken(token: string): Promise<string | null>;
  /** The comparison with its runs and bucket, read with the service role. */
  loadComparison(comparisonId: string): Promise<SignComparison | null>;
  presignGet(bucket: string, key: string, expiresInSeconds: number): Promise<string>;
}

/**
 * Share viewers (04 §5): a live token signs only objects of the comparison it was made for.
 * Revoked, expired or unknown tokens, and a `comparisonId` that is not the token's, answer 404.
 */
export async function signSharedObject(
  gateway: SharedSignGateway,
  input: { token: string; comparisonId?: string; key: string },
  now: () => number = Date.now,
): Promise<{ url: string; expiresAt: string }> {
  const comparisonId = isShareTokenShape(input.token)
    ? await gateway.resolveShareToken(input.token)
    : null;
  if (!comparisonId || (input.comparisonId && input.comparisonId !== comparisonId)) {
    throw new RequestError(404, 'not_found', 'Share link not found');
  }
  const comparison = await gateway.loadComparison(comparisonId);
  if (!comparison) throw new RequestError(404, 'not_found', 'Share link not found');
  if (!keyBelongsToComparison(input.key, comparison)) {
    throw new RequestError(403, 'forbidden', 'The key does not belong to this comparison');
  }
  const url = await gateway.presignGet(comparison.bucket, input.key, SIGN_TTL_SECONDS);
  return { url, expiresAt: new Date(now() + SIGN_TTL_SECONDS * 1000).toISOString() };
}
