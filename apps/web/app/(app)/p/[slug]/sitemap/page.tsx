import { AlertTriangle, Download } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FetchSitemapButton } from '@/components/sitemap/FetchSitemapButton';
import { ManualUrlsPanel } from '@/components/sitemap/ManualUrlsPanel';
import { SnapshotProgress } from '@/components/sitemap/SnapshotProgress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { requireUser } from '@/lib/auth/session';
import { canDo } from '@/lib/projects/access';
import { getProjectDetail } from '@/lib/projects/queries';
import {
  SITEMAP_FILTERS,
  SITEMAP_FILTER_LABELS,
  SITEMAP_PAGE_SIZE,
  isSnapshotStale,
  pageCount,
  parseSitemapQuery,
  sitemapHref,
  type SitemapQuery,
} from '@/lib/sitemap/filters';
import {
  diffWithPrevious,
  getUrlPage,
  listManualUrls,
  listSnapshots,
  type SnapshotSummary,
  type SnapshotUrlRow,
} from '@/lib/sitemap/queries';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Sitemap · Visual Regression Tool' };

type Params = Promise<{ slug: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function formatTime(iso: string) {
  return `${new Date(iso).toISOString().replace('T', ' ').slice(0, 16)} UTC`;
}

function StatusBadge({ status }: { status: SnapshotSummary['status'] }) {
  const styles: Record<string, string> = {
    running: 'border-transparent bg-blue-600 text-white',
    completed: 'border-transparent bg-emerald-600 text-white',
    failed: 'border-transparent bg-destructive text-white',
  };
  return <Badge className={styles[status]}>{status}</Badge>;
}

function SnapshotList({
  slug,
  snapshots,
  selectedId,
}: {
  slug: string;
  snapshots: SnapshotSummary[];
  selectedId: string;
}) {
  return (
    <ul aria-label="Snapshots" className="grid gap-1">
      {snapshots.map((snapshot) => (
        <li key={snapshot.id}>
          <Link
            href={sitemapHref(slug, { snapshotId: snapshot.id })}
            aria-current={snapshot.id === selectedId ? 'true' : undefined}
            className={cn(
              'grid gap-1 rounded-md border px-3 py-2 text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
              snapshot.id === selectedId && 'border-primary bg-accent',
            )}
          >
            <span className="flex items-center justify-between gap-2">
              <time dateTime={snapshot.createdAt}>{formatTime(snapshot.createdAt)}</time>
              <StatusBadge status={snapshot.status} />
            </span>
            <span className="text-xs text-muted-foreground">
              {snapshot.urlCount} included · {snapshot.redirectCount} redirects ·{' '}
              {snapshot.errorCount} errors
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function statusText(row: SnapshotUrlRow) {
  if (row.httpStatus === null) return '—';
  return String(row.httpStatus);
}

function UrlTable({ rows }: { rows: SnapshotUrlRow[] }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <caption className="sr-only">URLs of the snapshot</caption>
        <thead className="bg-muted/50 text-left">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              URL
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Kind
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Status
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Redirect target
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Included
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t align-top">
              <td className="px-3 py-2 font-mono break-all">
                {row.url}
                {row.source === 'manual' && (
                  <Badge variant="outline" className="ml-2 font-sans">
                    manual
                  </Badge>
                )}
              </td>
              <td className="px-3 py-2">{row.kind}</td>
              <td
                className={cn(
                  'px-3 py-2 tabular-nums',
                  row.httpStatus !== null && row.httpStatus >= 400 && 'text-destructive',
                )}
              >
                {statusText(row)}
              </td>
              <td className="px-3 py-2 font-mono break-all">{row.redirectTo ?? ''}</td>
              <td className="px-3 py-2">{row.included ? 'Yes' : 'No'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function SnapshotDetail({
  slug,
  snapshot,
  snapshots,
  query,
}: {
  slug: string;
  snapshot: SnapshotSummary;
  snapshots: SnapshotSummary[];
  query: SitemapQuery;
}) {
  if (snapshot.status === 'failed') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Snapshot failed</h2>
          </CardTitle>
          <CardDescription className="break-all">
            {snapshot.error ?? 'The sitemap could not be fetched.'}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }
  if (snapshot.status === 'running') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Snapshot in progress</h2>
          </CardTitle>
          <CardDescription>URLs are shown once the fetch has completed.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const [page, diff] = await Promise.all([
    getUrlPage(snapshot, query),
    diffWithPrevious(snapshot, snapshots),
  ]);
  const pages = pageCount(page.total);
  const current = { snapshotId: snapshot.id, filter: query.filter, search: query.search };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-wrap items-start justify-between gap-2">
          <div className="grid gap-1">
            <CardTitle>
              <h2>URLs</h2>
            </CardTitle>
            <CardDescription className="break-all">
              {snapshot.sourceUrl} · {snapshot.childSitemaps} child sitemaps
            </CardDescription>
          </div>
          <Button asChild variant="outline">
            <a href={`/api/snapshots/${snapshot.id}/sitemap.txt`} download="sitemap.txt">
              <Download aria-hidden />
              Export .txt
            </a>
          </Button>
        </CardHeader>
        <CardContent className="grid gap-4">
          <nav aria-label="URL filters" className="flex flex-wrap gap-1">
            {SITEMAP_FILTERS.map((filter) => (
              <Link
                key={filter}
                href={sitemapHref(slug, { ...current, filter })}
                aria-current={filter === query.filter ? 'true' : undefined}
                className={cn(
                  'rounded-md border px-2.5 py-1 text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
                  filter === query.filter && 'border-primary bg-accent font-medium',
                )}
              >
                {SITEMAP_FILTER_LABELS[filter]}{' '}
                <span className="text-muted-foreground tabular-nums">{page.counts[filter]}</span>
              </Link>
            ))}
          </nav>
          <form role="search" action={`/p/${slug}/sitemap`} className="flex gap-2">
            <input type="hidden" name="snapshot" value={snapshot.id} />
            {query.filter !== 'all' && <input type="hidden" name="filter" value={query.filter} />}
            <Input
              type="search"
              name="q"
              aria-label="Search URLs"
              placeholder="Search URLs"
              defaultValue={query.search}
              className="max-w-sm"
            />
            <Button type="submit" variant="outline">
              Search
            </Button>
          </form>
          {page.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No URLs match this filter.</p>
          ) : (
            <UrlTable rows={page.rows} />
          )}
          {pages > 1 && (
            <nav
              aria-label="Pagination"
              className="flex items-center justify-between gap-2 text-sm"
            >
              <span className="text-muted-foreground">
                Page {query.page} of {pages} · {page.total} URLs ({SITEMAP_PAGE_SIZE} per page)
              </span>
              <span className="flex gap-2">
                {query.page > 1 && (
                  <Button asChild variant="outline" size="sm">
                    <Link href={sitemapHref(slug, { ...current, page: query.page - 1 })}>
                      Previous
                    </Link>
                  </Button>
                )}
                {query.page < pages && (
                  <Button asChild variant="outline" size="sm">
                    <Link href={sitemapHref(slug, { ...current, page: query.page + 1 })}>Next</Link>
                  </Button>
                )}
              </span>
            </nav>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Diff vs previous</h2>
          </CardTitle>
          <CardDescription>
            {diff
              ? `Compared with the snapshot of ${formatTime(diff.previous.createdAt)}: ${diff.added.length} added, ${diff.removed.length} removed.`
              : 'There is no earlier completed snapshot to compare with.'}
          </CardDescription>
        </CardHeader>
        {diff && (diff.added.length > 0 || diff.removed.length > 0) && (
          <CardContent className="grid gap-4 md:grid-cols-2">
            <DiffList title="Added" urls={diff.added} />
            <DiffList title="Removed" urls={diff.removed} />
          </CardContent>
        )}
      </Card>
    </>
  );
}

const DIFF_LIST_LIMIT = 200;

function DiffList({ title, urls }: { title: string; urls: string[] }) {
  return (
    <section aria-label={`${title} URLs`} className="grid content-start gap-2">
      <h3 className="text-sm font-medium">
        {title} ({urls.length})
      </h3>
      {urls.length === 0 ? (
        <p className="text-sm text-muted-foreground">None</p>
      ) : (
        <ul className="grid max-h-80 gap-0.5 overflow-y-auto font-mono text-xs break-all">
          {urls.slice(0, DIFF_LIST_LIMIT).map((url) => (
            <li key={url}>{url}</li>
          ))}
          {urls.length > DIFF_LIST_LIMIT && (
            <li className="font-sans text-muted-foreground">
              and {urls.length - DIFF_LIST_LIMIT} more
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

/** Sitemap snapshots and URL table (08 §1, F-SITEMAP-1..4). Viewer+; actions editor+. */
export default async function SitemapPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { slug } = await params;
  const user = await requireUser();
  const project = await getProjectDetail(slug);
  if (!project) notFound();
  const query = parseSitemapQuery(await searchParams);
  const [snapshots, manualUrls, canEdit] = await Promise.all([
    listSnapshots(project.id),
    listManualUrls(project.id),
    canDo(user, 'sitemap.manage', project.id),
  ]);

  const selected = query.snapshotId
    ? snapshots.find((snapshot) => snapshot.id === query.snapshotId)
    : snapshots[0];
  if (query.snapshotId && !selected) notFound();
  const running = snapshots.find((snapshot) => snapshot.status === 'running');
  const latestCompleted = snapshots.find((snapshot) => snapshot.status === 'completed');
  const archived = Boolean(project.archivedAt);

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Sitemap</h1>
          <p className="text-sm break-all text-muted-foreground">{project.settings.sitemapIndex}</p>
        </div>
        {canEdit && (
          <FetchSitemapButton projectId={project.id} disabled={archived || Boolean(running)} />
        )}
      </div>

      {running && (
        <SnapshotProgress
          key={running.id}
          initial={{
            id: running.id,
            status: running.status,
            childSitemaps: running.childSitemaps,
            urlsChecked: running.urlsChecked,
            urlsTotal: running.urlsTotal,
            error: running.error,
          }}
        />
      )}

      {latestCompleted && isSnapshotStale(latestCompleted.createdAt) && (
        <p
          role="note"
          className="flex items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm"
        >
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          The latest completed snapshot is older than 7 days. Fetch the sitemap again before the
          next run.
        </p>
      )}

      {!selected ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>No snapshots yet</h2>
            </CardTitle>
            <CardDescription>
              {canEdit
                ? 'Fetch the sitemap to create the first URL snapshot.'
                : 'An editor has to fetch the sitemap first.'}
            </CardDescription>
          </CardHeader>
          {canEdit && (
            <CardContent>
              <FetchSitemapButton projectId={project.id} disabled={archived} variant="outline" />
            </CardContent>
          )}
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
          <section aria-labelledby="snapshots-heading" className="grid content-start gap-2">
            <h2 id="snapshots-heading" className="text-sm font-semibold">
              Snapshots
            </h2>
            <SnapshotList slug={slug} snapshots={snapshots} selectedId={selected.id} />
          </section>
          <div className="grid min-w-0 content-start gap-6">
            <SnapshotDetail slug={slug} snapshot={selected} snapshots={snapshots} query={query} />
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Manual URLs</h2>
          </CardTitle>
          <CardDescription>
            URLs that are not in the sitemap but should be captured. They are merged into every new
            snapshot.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ManualUrlsPanel
            projectId={project.id}
            urls={manualUrls}
            canEdit={canEdit && !archived}
          />
        </CardContent>
      </Card>
    </div>
  );
}
