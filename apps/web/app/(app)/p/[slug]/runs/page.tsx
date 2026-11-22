import { Flag } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { NewRunDialog } from '@/components/runs/NewRunDialog';
import { RunStatusBadge } from '@/components/runs/RunStatusBadge';
import { formatTime, runDuration } from '@/components/runs/format';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/session';
import { canDo } from '@/lib/projects/access';
import { getProjectDetail, listViewports } from '@/lib/projects/queries';
import { DEFAULT_ITEM_MS, formatBytes, isActiveRun, totalBytes } from '@/lib/runs/progress';
import {
  averageItemMs,
  getBaselineRunId,
  listRuns,
  runItemStats,
  type RunSummary,
} from '@/lib/runs/queries';
import { listSnapshots } from '@/lib/sitemap/queries';

export const metadata: Metadata = { title: 'Runs · Visual Regression Tool' };

type Params = Promise<{ slug: string }>;

function RunsTable({
  slug,
  runs,
  sizes,
  baselineRunId,
}: {
  slug: string;
  runs: RunSummary[];
  sizes: Map<string, number>;
  baselineRunId: string | null;
}) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <caption className="sr-only">Runs of the project</caption>
        <thead className="bg-muted/50 text-left">
          <tr>
            {['Label', 'Status', 'Items', 'Size', 'Started by', 'Duration'].map((h) => (
              <th key={h} scope="col" className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id} className="border-t align-top">
              <td className="px-3 py-2">
                <Link
                  href={`/p/${slug}/runs/${run.label}`}
                  className="font-mono font-medium underline-offset-4 hover:underline"
                >
                  {run.label}
                </Link>
                {run.id === baselineRunId && (
                  <span className="ml-2 inline-flex items-center gap-1 text-xs text-primary">
                    <Flag className="size-3" aria-hidden />
                    baseline
                  </span>
                )}
                {run.note && <p className="text-xs break-all text-muted-foreground">{run.note}</p>}
              </td>
              <td className="px-3 py-2">
                <RunStatusBadge status={run.status} />
              </td>
              <td className="px-3 py-2 tabular-nums">
                {run.doneItems}/{run.totalItems}
                {run.failedItems > 0 && (
                  <span className="text-destructive"> · {run.failedItems} failed</span>
                )}
              </td>
              <td className="px-3 py-2 tabular-nums">{formatBytes(sizes.get(run.id) ?? 0)}</td>
              <td className="px-3 py-2">{run.startedBy ?? '—'}</td>
              <td className="px-3 py-2 tabular-nums">
                {runDuration(run)}
                <p className="text-xs text-muted-foreground">{formatTime(run.createdAt)}</p>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Runs list and new run dialog (08 §1, F-RUN-1/3). Viewer+; starting runs editor+. */
export default async function RunsPage({ params }: { params: Params }) {
  const { slug } = await params;
  const user = await requireUser();
  const project = await getProjectDetail(slug);
  if (!project) notFound();
  const [runs, canEdit, baselineRunId] = await Promise.all([
    listRuns(project.id),
    canDo(user, 'run.manage', project.id),
    getBaselineRunId(project.id),
  ]);
  const stats = await runItemStats(runs.map((run) => run.id));
  const sizes = new Map([...stats].map(([id, rows]) => [id, totalBytes(rows)]));

  const [snapshots, viewports, itemMs] = canEdit
    ? await Promise.all([
        listSnapshots(project.id),
        listViewports(project.id),
        averageItemMs(project.id),
      ])
    : [[], [], null];
  const completed = snapshots.filter((s) => s.status === 'completed');
  const active = runs.find((run) => isActiveRun(run.status));
  const archived = Boolean(project.archivedAt);

  const dialog = (variant: 'default' | 'outline') => (
    <NewRunDialog
      projectId={project.id}
      slug={slug}
      variant={variant}
      snapshots={completed.map((s) => ({ id: s.id, createdAt: s.createdAt, urlCount: s.urlCount }))}
      viewports={viewports.map((v) => ({
        slug: v.slug,
        width: v.width,
        height: v.height,
        enabled: v.enabled,
      }))}
      concurrency={project.settings.captureConcurrency}
      itemMs={itemMs ?? DEFAULT_ITEM_MS}
      disabled={archived || Boolean(active) || completed.length === 0}
    />
  );

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Runs</h1>
          <p className="text-sm text-muted-foreground">
            {active ? (
              <>
                Run{' '}
                <Link href={`/p/${slug}/runs/${active.label}`} className="underline">
                  {active.label}
                </Link>{' '}
                is in progress; only one run can be active at a time.
              </>
            ) : (
              'Screenshot sets captured from a sitemap snapshot.'
            )}
          </p>
        </div>
        {canEdit && dialog('default')}
      </div>

      {runs.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>No runs yet</h2>
            </CardTitle>
            <CardDescription>
              {completed.length === 0 && canEdit ? (
                <>
                  <Link href={`/p/${slug}/sitemap`} className="underline">
                    Fetch the sitemap
                  </Link>{' '}
                  first, then start a run.
                </>
              ) : canEdit ? (
                'Start a run to capture the first screenshot set.'
              ) : (
                'An editor has to start the first run.'
              )}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <RunsTable slug={slug} runs={runs} sizes={sizes} baselineRunId={baselineRunId} />
      )}
    </div>
  );
}
