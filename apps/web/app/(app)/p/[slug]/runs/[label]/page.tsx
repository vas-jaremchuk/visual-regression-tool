import { Flag } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { selectClassName } from '@/components/members/role-select-class';
import { RunActions } from '@/components/runs/RunActions';
import { RunProgress } from '@/components/runs/RunProgress';
import { RunStatusBadge } from '@/components/runs/RunStatusBadge';
import { ScreenshotLightbox } from '@/components/runs/ScreenshotLightbox';
import { formatTime, runDuration } from '@/components/runs/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { requireUser } from '@/lib/auth/session';
import { canDo } from '@/lib/projects/access';
import { getProjectDetail } from '@/lib/projects/queries';
import { viewportProgress } from '@/lib/runs/progress';
import {
  ITEM_PAGE_SIZE,
  ITEM_STATUSES,
  getBaselineRunId,
  getFailureGroups,
  getItemPage,
  getRun,
  imageUrlBuilder,
  parseItemQuery,
  runItemStats,
  type ItemQuery,
  type RunDetail,
} from '@/lib/runs/queries';
import { cn } from '@/lib/utils';

type Params = Promise<{ slug: string; label: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const TABS = [
  { key: 'items', label: 'Items' },
  { key: 'failures', label: 'Failures' },
  { key: 'settings', label: 'Settings used' },
] as const;
type Tab = (typeof TABS)[number]['key'];

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { label } = await params;
  return { title: `Run ${decodeURIComponent(label)} · Visual Regression Tool` };
}

function itemsHref(base: string, query: Partial<ItemQuery>) {
  const search = new URLSearchParams();
  if (query.status) search.set('status', query.status);
  if (query.viewport) search.set('viewport', query.viewport);
  if (query.search) search.set('q', query.search);
  if (query.page && query.page > 1) search.set('page', String(query.page));
  const qs = search.toString();
  return qs ? `${base}?${qs}` : base;
}

async function ItemsTab({
  base,
  run,
  project,
  query,
}: {
  base: string;
  run: RunDetail;
  project: { r2Bucket: string; r2PublicUrl: string | null };
  query: ItemQuery;
}) {
  const page = await getItemPage(run.id, query, await imageUrlBuilder(project));
  const pages = Math.max(1, Math.ceil(page.total / ITEM_PAGE_SIZE));
  return (
    <div className="grid gap-4">
      <form role="search" action={base} className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-xs">
          Status
          <select name="status" defaultValue={query.status ?? ''} className={selectClassName}>
            <option value="">All</option>
            {ITEM_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs">
          Viewport
          <select name="viewport" defaultValue={query.viewport ?? ''} className={selectClassName}>
            <option value="">All</option>
            {run.viewportSlugs.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
            <option value="_files">files</option>
          </select>
        </label>
        <Input
          type="search"
          name="q"
          aria-label="Search URLs"
          placeholder="Search URLs"
          defaultValue={query.search}
          className="max-w-sm"
        />
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>

      {page.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No items match these filters.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <caption className="sr-only">Items of the run</caption>
            <thead className="bg-muted/50 text-left">
              <tr>
                {['Screenshot', 'URL', 'Viewport', 'Size', 'Status', 'Error'].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {page.rows.map((item) => (
                <tr key={item.id} className="border-t align-top">
                  <td className="px-3 py-2">
                    {item.imageUrl ? (
                      <ScreenshotLightbox
                        src={item.imageUrl}
                        url={item.url}
                        viewport={item.viewportSlug}
                        truncated={item.truncated}
                        height={item.height}
                      />
                    ) : (
                      <span className="flex h-20 w-20 items-center justify-center rounded border text-xs text-muted-foreground">
                        {item.kind === 'file' ? 'file' : 'none'}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono break-all">{item.url}</td>
                  <td className="px-3 py-2">{item.viewportSlug ?? 'file'}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {item.width && item.height ? `${item.width}×${item.height}` : '—'}
                    {item.truncated && (
                      <Badge variant="outline" className="ml-2">
                        truncated
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <RunStatusBadge status={item.status} />
                  </td>
                  <td className="px-3 py-2 break-all text-destructive">{item.error ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <nav aria-label="Pagination" className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">
            Page {query.page} of {pages} · {page.total} items
          </span>
          <span className="flex gap-2">
            {query.page > 1 && (
              <Button asChild variant="outline" size="sm">
                <Link href={itemsHref(base, { ...query, page: query.page - 1 })}>Previous</Link>
              </Button>
            )}
            {query.page < pages && (
              <Button asChild variant="outline" size="sm">
                <Link href={itemsHref(base, { ...query, page: query.page + 1 })}>Next</Link>
              </Button>
            )}
          </span>
        </nav>
      )}
    </div>
  );
}

async function FailuresTab({ run }: { run: RunDetail }) {
  const groups = await getFailureGroups(run.id);
  if (groups.length === 0) {
    return <p className="text-sm text-muted-foreground">No failed items.</p>;
  }
  return (
    <div className="grid gap-4">
      {groups.map((group) => (
        <section key={group.error} aria-label={group.error} className="grid gap-1">
          <h3 className="text-sm font-medium break-all">
            {group.error}{' '}
            <span className="text-muted-foreground tabular-nums">({group.items.length})</span>
          </h3>
          <ul className="grid gap-0.5 font-mono text-xs break-all">
            {group.items.map((item) => (
              <li key={item.id}>
                {item.url}{' '}
                <span className="text-muted-foreground">{item.viewportSlug ?? 'file'}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Run detail (08 §3, F-RUN-3/4): live progress, items, failures, frozen settings. Viewer+. */
export default async function RunDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { slug, label } = await params;
  const user = await requireUser();
  const project = await getProjectDetail(slug);
  if (!project) notFound();
  const run = await getRun(project.id, decodeURIComponent(label));
  if (!run) notFound();
  const search = await searchParams;
  const tabParam = Array.isArray(search.tab) ? search.tab[0] : search.tab;
  const tab: Tab = TABS.some((t) => t.key === tabParam) ? (tabParam as Tab) : 'items';
  const query = parseItemQuery(search);

  const [stats, canEdit, canDelete, baselineRunId] = await Promise.all([
    runItemStats([run.id]),
    canDo(user, 'run.manage', project.id),
    canDo(user, 'project.settings', project.id),
    getBaselineRunId(project.id),
  ]);
  const base = `/p/${slug}/runs/${run.label}`;
  const isBaseline = baselineRunId === run.id;

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-1">
          <h1 className="flex flex-wrap items-center gap-2 font-mono text-2xl font-semibold">
            {run.label}
            <RunStatusBadge status={run.status} />
            {isBaseline && (
              <Badge variant="outline" className="gap-1 font-sans">
                <Flag className="size-3" aria-hidden />
                baseline
              </Badge>
            )}
          </h1>
          {run.note && <p className="text-sm break-all">{run.note}</p>}
          <p className="text-sm text-muted-foreground">
            Started by {run.startedBy ?? 'unknown'} · {formatTime(run.startedAt ?? run.createdAt)} ·
            duration {runDuration(run)}
          </p>
        </div>
        {canEdit && (
          <RunActions
            projectId={project.id}
            slug={slug}
            baselineRunId={baselineRunId}
            runId={run.id}
            status={run.status}
            failedItems={run.failedItems}
            cancelRequested={Boolean(run.cancelRequestedAt)}
            isBaseline={isBaseline}
            canDelete={canDelete}
          />
        )}
      </div>

      <RunProgress
        initial={{
          id: run.id,
          status: run.status,
          total: run.totalItems,
          done: run.doneItems,
          failed: run.failedItems,
          startedAt: run.startedAt,
        }}
        viewports={viewportProgress(run.viewportSlugs, stats.get(run.id) ?? [])}
      />

      <Card>
        <CardHeader className="gap-3">
          <CardTitle>
            <h2 className="sr-only">Run details</h2>
          </CardTitle>
          <nav aria-label="Run tabs" className="flex flex-wrap gap-1">
            {TABS.map((t) => (
              <Link
                key={t.key}
                href={t.key === 'items' ? base : `${base}?tab=${t.key}`}
                aria-current={t.key === tab ? 'page' : undefined}
                className={cn(
                  'rounded-md border px-2.5 py-1 text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
                  t.key === tab && 'border-primary bg-accent font-medium',
                )}
              >
                {t.label}
                {t.key === 'failures' && run.failedItems > 0 && (
                  <span className="ml-1 text-muted-foreground tabular-nums">{run.failedItems}</span>
                )}
              </Link>
            ))}
          </nav>
          {tab === 'settings' && (
            <CardDescription>Settings frozen when the run started.</CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {tab === 'items' && (
            <ItemsTab base={base} run={run} project={project.settings} query={query} />
          )}
          {tab === 'failures' && <FailuresTab run={run} />}
          {tab === 'settings' && (
            <pre className="max-h-[32rem] overflow-auto rounded-md bg-muted p-3 text-xs">
              {JSON.stringify(run.settings, null, 2)}
            </pre>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
