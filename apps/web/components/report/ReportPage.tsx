import { id } from '@vrt/shared';
import { Download } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { requireUser } from '@/lib/auth/session';
import { DEFAULT_FILTER } from '@/lib/comparisons/report';
import { fetchItemPage } from '@/lib/comparisons/report-items';
import {
  getReportHeader,
  getReportItem,
  getReportSections,
} from '@/lib/comparisons/report-queries';
import { reviewProgress } from '@/lib/comparisons/queries';
import { canDo } from '@/lib/projects/access';
import { getProjectDetail } from '@/lib/projects/queries';
import { createClient } from '@/lib/supabase/server';
import { ReportSections } from './ReportSections';
import { ShareDialog } from './ShareDialog';
import { ReportView } from './ReportView';

const STATUS_CLASS: Record<string, string> = {
  queued: 'border-transparent bg-muted text-foreground',
  running: 'border-transparent bg-blue-600 text-white',
  completed: 'border-transparent bg-emerald-600 text-white',
  failed: 'border-transparent bg-destructive text-white',
};

/**
 * Report (08 §3) for `/p/[slug]/comparisons/[id]` and the deep-linked item viewer
 * `/p/[slug]/comparisons/[id]/items/[itemId]`. Viewer+; RLS hides other projects' comparisons.
 */
export async function ReportPage({
  slug,
  comparisonId,
  itemId,
}: {
  slug: string;
  comparisonId: string;
  itemId?: string;
}) {
  const user = await requireUser();
  if (!id.safeParse(comparisonId).success) notFound();
  if (itemId !== undefined && !id.safeParse(itemId).success) notFound();
  const project = await getProjectDetail(slug);
  if (!project) notFound();
  const header = await getReportHeader(project.id, comparisonId);
  if (!header) notFound();
  const [firstPage, sections, item, canShare] = await Promise.all([
    fetchItemPage(await createClient(), comparisonId, DEFAULT_FILTER, 0, { count: true }),
    getReportSections(comparisonId),
    itemId ? getReportItem(comparisonId, itemId) : Promise.resolve(null),
    canDo(user, 'share_link.manage', project.id),
  ]);
  if (itemId && !item) notFound();
  const progress = reviewProgress(header.reviewCounts);

  return (
    <div className="mx-auto grid max-w-[100rem] gap-6">
      <header className="grid gap-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-xl font-semibold">
            <Link href={`/p/${slug}/runs/${header.beforeLabel}`} className="hover:underline">
              {header.beforeLabel}
            </Link>{' '}
            <span aria-label="versus">↔</span>{' '}
            <Link href={`/p/${slug}/runs/${header.afterLabel}`} className="hover:underline">
              {header.afterLabel}
            </Link>
          </h1>
          <Badge className={STATUS_CLASS[header.status]}>{header.status}</Badge>
          <div className="ml-auto flex flex-wrap gap-2">
            {canShare && (
              <ShareDialog
                comparisonId={comparisonId}
                active={header.share.active}
                expiresAt={header.share.expiresAt}
              />
            )}
            {header.status === 'completed' && (
              <Button asChild variant="outline" size="sm">
                <a href={`/api/comparisons/${comparisonId}/export.html`} download>
                  <Download aria-hidden />
                  Download HTML
                </a>
              </Button>
            )}
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Threshold: &gt;{header.changeThresholdPct ?? 0}% pixel change
          {progress.total > 0 && ` · ${progress.reviewed}/${progress.total} reviewed`}
        </p>
        {(header.status === 'queued' || header.status === 'running') && (
          <p role="status" className="text-sm text-muted-foreground">
            The comparison is still running; reload to see more results.
          </p>
        )}
      </header>

      <ReportView
        key={itemId ?? 'report'}
        slug={slug}
        comparisonId={comparisonId}
        publicUrl={project.settings.r2PublicUrl ?? null}
        beforeLabel={header.beforeLabel}
        afterLabel={header.afterLabel}
        counts={header.counts}
        viewports={header.viewports}
        changeThresholdPct={header.changeThresholdPct}
        initialItems={firstPage.items}
        initialTotal={firstPage.total ?? 0}
        initialItem={item}
      />

      <ReportSections sections={sections} />
    </div>
  );
}
