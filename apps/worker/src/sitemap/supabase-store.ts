import type { SupabaseClient } from '@supabase/supabase-js';
import type { IgnoreRule, SnapshotUrl } from '@vrt/engine';
import type { SitemapProject, SitemapStore, SnapshotRow } from './sitemap-job';

/** `SitemapStore` over the service-role Supabase client (RLS bypassed; worker only). */

const PAGE = 1000;

function check<T>(what: string, result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(`Could not ${what}: ${result.error.message}`);
  return result.data;
}

export function supabaseSitemapStore(db: SupabaseClient): SitemapStore {
  return {
    async loadSnapshot(snapshotId) {
      const row = check(
        'load the snapshot',
        await db
          .from('sitemap_snapshots')
          .select('id, project_id, status, source_url')
          .eq('id', snapshotId)
          .maybeSingle(),
      );
      if (!row) return null;
      return {
        id: row.id,
        projectId: row.project_id,
        status: row.status,
        sourceUrl: row.source_url,
      } as SnapshotRow;
    },

    async loadProject(projectId) {
      const row = check(
        'load the project',
        await db
          .from('projects')
          .select('check_redirects, basic_auth_user, basic_auth_pass_enc, file_extensions')
          .eq('id', projectId)
          .maybeSingle(),
      );
      if (!row) throw new Error(`Project ${projectId} not found`);
      return {
        checkRedirects: row.check_redirects,
        basicAuthUser: row.basic_auth_user,
        basicAuthPassEnc: row.basic_auth_pass_enc,
        fileExtensions: row.file_extensions,
      } as SitemapProject;
    },

    async loadManualUrls(projectId) {
      const rows = check(
        'load manual URLs',
        await db.from('project_manual_urls').select('url').eq('project_id', projectId),
      );
      return (rows as { url: string }[]).map((r) => r.url);
    },

    async loadIgnoreRules(projectId) {
      const rows = check(
        'load ignore rules',
        await db
          .from('ignore_rules')
          .select('type, url_pattern, viewport_slug, applies_to, enabled')
          .eq('project_id', projectId)
          .eq('type', 'url_pattern'),
      );
      return rows as IgnoreRule[];
    },

    async updateSnapshot(snapshotId, patch) {
      check(
        'update the snapshot',
        await db.from('sitemap_snapshots').update(patch).eq('id', snapshotId),
      );
    },

    async upsertUrls(snapshotId, rows) {
      for (let i = 0; i < rows.length; i += PAGE) {
        const chunk = rows.slice(i, i + PAGE).map((r) => ({
          snapshot_id: snapshotId,
          url: r.url,
          kind: r.kind,
          http_status: r.httpStatus,
          redirect_to: r.redirectTo,
          included: r.included,
          source: r.source,
        }));
        check(
          'store snapshot URLs',
          await db.from('sitemap_urls').upsert(chunk, { onConflict: 'snapshot_id,url' }),
        );
      }
    },

    async listUrls(snapshotId, offset = 0, limit = Number.POSITIVE_INFINITY) {
      const out: SnapshotUrl[] = [];
      for (let from = offset; out.length < limit; from += PAGE) {
        const to = from + Math.min(PAGE, limit - out.length) - 1;
        const rows = check(
          'list snapshot URLs',
          await db
            .from('sitemap_urls')
            .select('url, kind, http_status, redirect_to, included, source')
            .eq('snapshot_id', snapshotId)
            .order('url')
            .range(from, to),
        ) as {
          url: string;
          kind: SnapshotUrl['kind'];
          http_status: number | null;
          redirect_to: string | null;
          included: boolean;
          source: SnapshotUrl['source'];
        }[];
        for (const r of rows) {
          out.push({
            url: r.url,
            kind: r.kind,
            httpStatus: r.http_status,
            redirectTo: r.redirect_to,
            included: r.included,
            source: r.source,
          });
        }
        if (rows.length < to - from + 1) break;
      }
      return out;
    },
  };
}
