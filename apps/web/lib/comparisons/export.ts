import { renderStaticReport, type ReportItem as StaticReportItem } from '@vrt/engine';
import type { PermissionAction } from '@vrt/shared';
import { RequestError } from '../members/errors';
import { keyBelongsToComparison } from './report';

/**
 * Static HTML download (F-CMP-8, REQ-ENG-9): the same document the compare workflow exports to
 * `reports/<label>/index.html`, for everyone who can view the comparison, with or without a public
 * URL. Images are always absolute: under `r2_public_url`, else presigned R2 URLs, so the file keeps
 * working when opened from disk. Pure orchestration over `ExportGateway`.
 */

/** Presigned image URLs in a download live as long as SigV4 allows (7 days). */
export const EXPORT_SIGN_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface ExportComparison {
  id: string;
  projectId: string;
  projectName: string;
  label: string;
  beforeLabel: string;
  afterLabel: string;
  changeThresholdPct: number;
  publicUrl: string | null;
  bucket: string;
}

export interface ExportGateway {
  /** The comparison with its project (RLS: only comparisons the user can view). */
  loadComparison(comparisonId: string): Promise<ExportComparison | null>;
  assertCan(action: PermissionAction, projectId: string): Promise<void>;
  /** Every item of the comparison, pages and files. */
  listItems(comparisonId: string): Promise<StaticReportItem[]>;
  presignGet(bucket: string, key: string, expiresInSeconds: number): Promise<string>;
}

export async function exportComparisonHtml(
  gateway: ExportGateway,
  comparisonId: string,
  options: { now?: Date } = {},
): Promise<{ filename: string; html: string }> {
  const comparison = await gateway.loadComparison(comparisonId);
  if (!comparison) throw new RequestError(404, 'not_found', 'Comparison not found');
  await gateway.assertCan('project.view', comparison.projectId);
  const items = await gateway.listItems(comparison.id);

  let imageUrl: ((key: string) => string) | undefined;
  if (!comparison.publicUrl) {
    const signed = new Map<string, string>();
    for (const item of items) {
      for (const key of [item.before_key, item.after_key, item.diff_key]) {
        if (!key || signed.has(key) || !keyBelongsToComparison(key, comparison)) continue;
        signed.set(key, await gateway.presignGet(comparison.bucket, key, EXPORT_SIGN_TTL_SECONDS));
      }
    }
    imageUrl = (key) => signed.get(key) ?? '';
  }

  const html = renderStaticReport(
    {
      label: comparison.label,
      project_name: comparison.projectName,
      before_label: comparison.beforeLabel,
      after_label: comparison.afterLabel,
      change_threshold_pct: comparison.changeThresholdPct,
    },
    items,
    { publicUrl: comparison.publicUrl, imageUrl, generatedAt: options.now },
  );
  return { filename: `${comparison.label}.html`, html };
}
