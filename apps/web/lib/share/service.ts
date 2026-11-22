import 'server-only';
import { audit } from '../audit';
import { assertCan } from '../auth/assert-can';
import type { CurrentUser } from '../auth/session';
import { DEFAULT_FILTER, type ItemFilter } from '../comparisons/report';
import { fetchItemPage, type ItemPage, type ReportItem } from '../comparisons/report-items';
import {
  getReportHeader,
  getReportSections,
  type ReportHeader,
  type ReportSectionsData,
} from '../comparisons/report-queries';
import { serverEnv } from '../env';
import { createAdminClient } from '../supabase/admin';
import { createClient } from '../supabase/server';
import { createShareCommands, type ShareGateway } from './commands';
import { resolveShareToken } from './resolve';

/** Share link commands as the signed-in user: reads and writes go through RLS. */
export async function shareCommands(user: CurrentUser | null) {
  const supabase = await createClient();
  const gateway: ShareGateway = {
    async loadComparison(comparisonId) {
      const { data, error } = await supabase
        .from('comparisons')
        .select('id, project_id, label')
        .eq('id', comparisonId)
        .maybeSingle();
      if (error) throw new Error(`Could not load the comparison: ${error.message}`);
      return data ? { id: data.id, projectId: data.project_id, label: data.label } : null;
    },
    async assertCan(action, projectId) {
      await assertCan(user, action, projectId);
    },
    async setShare(comparisonId, share) {
      const { error } = await supabase
        .from('comparisons')
        .update({
          share_token_hash: share?.tokenHash ?? null,
          share_expires_at: share?.expiresAt ?? null,
        })
        .eq('id', comparisonId);
      if (error) throw new Error(`Could not update the share link: ${error.message}`);
    },
    audit: (action, projectId, details) => audit(supabase, action, projectId, details),
  };
  return createShareCommands(gateway, { appUrl: serverEnv().APP_URL });
}

export interface SharedReport {
  comparisonId: string;
  projectName: string;
  publicUrl: string | null;
  header: ReportHeader;
  firstPage: ItemPage;
  sections: ReportSectionsData;
}

/**
 * The read-only report behind a share token (04 §5), or null for an unknown, revoked or expired
 * token. The service role is used only after the token resolved, and every query is filtered by
 * the comparison it resolved to, so nothing else of the project is read (ADR-6).
 */
export async function getSharedReport(token: string): Promise<SharedReport | null> {
  const admin = createAdminClient();
  const comparisonId = await resolveShareToken(admin, token);
  if (!comparisonId) return null;
  const { data: comparison, error } = await admin
    .from('comparisons')
    .select('project_id')
    .eq('id', comparisonId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the comparison: ${error.message}`);
  if (!comparison) return null;
  const { data: project, error: projectError } = await admin
    .from('projects')
    .select('name, r2_public_url')
    .eq('id', comparison.project_id)
    .maybeSingle();
  if (projectError) throw new Error(`Could not load the project: ${projectError.message}`);
  if (!project) return null;
  const header = await getReportHeader(comparison.project_id, comparisonId, admin);
  if (!header) return null;
  const [firstPage, sections] = await Promise.all([
    fetchItemPage(admin, comparisonId, DEFAULT_FILTER, 0, { count: true }),
    getReportSections(comparisonId, admin),
  ]);
  return {
    comparisonId,
    projectName: project.name,
    publicUrl: project.r2_public_url,
    header,
    firstPage,
    sections,
  };
}

/** A page of the shared comparison's items, or null when the token no longer resolves. */
export async function fetchSharedItemPage(
  token: string,
  filter: ItemFilter,
  offset: number,
): Promise<{ items: ReportItem[]; total: number | null } | null> {
  const admin = createAdminClient();
  const comparisonId = await resolveShareToken(admin, token);
  if (!comparisonId) return null;
  return fetchItemPage(admin, comparisonId, filter, offset, { count: offset === 0 });
}
