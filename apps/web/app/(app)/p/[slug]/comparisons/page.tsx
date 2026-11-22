import { Flag } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StartComparisonForm } from '@/components/comparisons/StartComparisonForm';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/session';
import { defaultPair } from '@/lib/comparisons/defaults';
import {
  COMPARISON_LIST_LIMIT,
  listComparableRuns,
  listComparisons,
  reviewProgress,
  type ComparisonSummary,
} from '@/lib/comparisons/queries';
import { canDo } from '@/lib/projects/access';
import { getProjectDetail } from '@/lib/projects/queries';

export const metadata: Metadata = { title: 'Comparisons · Visual Regression Tool' };

type Params = Promise<{ slug: string }>;

function formatTime(iso: string) {
  return `${new Date(iso).toISOString().replace('T', ' ').slice(0, 16)} UTC`;
}

function StatusBadge({ status }: { status: ComparisonSummary['status'] }) {
  const styles: Record<string, string> = {
    queued: 'border-transparent bg-muted text-foreground',
    running: 'border-transparent bg-blue-600 text-white',
    completed: 'border-transparent bg-emerald-600 text-white',
    failed: 'border-transparent bg-destructive text-white',
  };
  return <Badge className={styles[status]}>{status}</Badge>;
}

function CountsText({ counts }: { counts: ComparisonSummary['counts'] }) {
  const parts = [
    `${counts.compared ?? 0} compared`,
    `${counts.changed ?? 0} changed`,
    `${counts.new ?? 0} new`,
    `${counts.missing ?? 0} missing`,
    `${counts.redirect ?? 0} redirected`,
    `files ${counts.files_changed ?? 0}/${counts.files_total ?? 0} changed`,
  ];
  if (counts.error) parts.push(`${counts.error} errors`);
  return <span className="tabular-nums">{parts.join(' · ')}</span>;
}

function BaselineBadge() {
  return (
    <span className="ml-1 inline-flex items-center gap-1 font-sans text-xs text-primary">
      <Flag className="size-3" aria-hidden />
      baseline
    </span>
  );
}

/** "12/40 reviewed" with a bar; changed items with a review other than pending (F-REVIEW-4). */
function ReviewProgress({ counts }: { counts: ComparisonSummary['reviewCounts'] }) {
  const progress = reviewProgress(counts);
  if (progress.total === 0) return <span className="text-muted-foreground">—</span>;
  const done = progress.reviewed === progress.total;
  return (
    <div className="grid min-w-28 gap-1">
      <span>
        {progress.reviewed}/{progress.total} reviewed{done && ' ✅'}
      </span>
      <div
        role="progressbar"
        aria-label="Review progress"
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.reviewed}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={done ? 'h-full bg-emerald-600' : 'h-full bg-blue-600'}
          style={{ width: `${(progress.reviewed / progress.total) * 100}%` }}
        />
      </div>
    </div>
  );
}

function ComparisonTable({
  slug,
  comparisons,
  baselineRunId,
}: {
  slug: string;
  comparisons: ComparisonSummary[];
  baselineRunId: string | null;
}) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <caption className="sr-only">Comparisons of the project</caption>
        <thead className="bg-muted/50 text-left">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Pair
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Status
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Counts
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Review
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Started
            </th>
          </tr>
        </thead>
        <tbody>
          {comparisons.map((cmp) => {
            return (
              <tr key={cmp.id} className="border-t align-top">
                <td className="px-3 py-2 font-mono">
                  <Link href={`/p/${slug}/comparisons/${cmp.id}`} className="hover:underline">
                    {cmp.beforeLabel} → {cmp.afterLabel}
                  </Link>
                  {(cmp.beforeRunId === baselineRunId || cmp.afterRunId === baselineRunId) && (
                    <BaselineBadge />
                  )}
                </td>
                <td className="px-3 py-2">
                  <StatusBadge status={cmp.status} />
                </td>
                <td className="px-3 py-2">
                  <CountsText counts={cmp.counts} />
                </td>
                <td className="px-3 py-2 tabular-nums">
                  <ReviewProgress counts={cmp.reviewCounts} />
                </td>
                <td className="px-3 py-2">
                  <time dateTime={cmp.createdAt}>{formatTime(cmp.createdAt)}</time>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Comparisons list (08, F-CMP-7) with the start form (F-CMP-1). Viewer+; starting editor+. */
export default async function ComparisonsPage({ params }: { params: Params }) {
  const { slug } = await params;
  const user = await requireUser();
  const project = await getProjectDetail(slug);
  if (!project) notFound();
  const [comparisons, { runs, baselineRunId }, canStart] = await Promise.all([
    listComparisons(project.id),
    listComparableRuns(project.id),
    canDo(user, 'comparison.start', project.id),
  ]);
  const defaults = defaultPair(runs, baselineRunId);

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Comparisons</h1>
        <p className="text-sm text-muted-foreground">
          Before/after pairs of completed runs, newest first.
        </p>
      </div>

      {canStart && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>New comparison</h2>
            </CardTitle>
            <CardDescription>
              {defaults
                ? 'The before run must be older than the after run.'
                : 'At least two completed runs are needed to compare.'}
            </CardDescription>
          </CardHeader>
          {defaults && (
            <CardContent>
              <StartComparisonForm
                projectId={project.id}
                runs={runs.map((r) => ({
                  id: r.id,
                  label: r.label,
                  baseline: r.id === baselineRunId,
                }))}
                defaults={defaults}
                disabled={Boolean(project.archivedAt)}
              />
            </CardContent>
          )}
        </Card>
      )}

      {comparisons.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>No comparisons yet</h2>
            </CardTitle>
            <CardDescription>
              {canStart
                ? 'Pick two completed runs above to compare them.'
                : 'An editor has to start the first comparison.'}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <section aria-labelledby="comparisons-heading" className="grid gap-2">
          <h2 id="comparisons-heading" className="sr-only">
            Comparisons
          </h2>
          <ComparisonTable slug={slug} comparisons={comparisons} baselineRunId={baselineRunId} />
          {comparisons.length === COMPARISON_LIST_LIMIT && (
            <p className="text-sm text-muted-foreground">
              Showing the newest {COMPARISON_LIST_LIMIT} comparisons.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
