import { FREE_TIER_BYTES, formatBytes, retentionProposals } from '@vrt/shared';
import type { Metadata } from 'next';
import { forbidden, notFound } from 'next/navigation';
import { DeleteEntityButton } from '@/components/storage/DeleteEntityButton';
import { RefreshStorageButton } from '@/components/storage/RefreshStorageButton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { requireUser } from '@/lib/auth/session';
import { canDo } from '@/lib/projects/access';
import { getProjectDetail } from '@/lib/projects/queries';
import {
  STORAGE_LIST_LIMIT,
  getStorageUsage,
  listStorageComparisons,
  listStorageRuns,
  type StorageRun,
  type StorageUsageRow,
} from '@/lib/storage/queries';

export const metadata: Metadata = { title: 'Storage · Visual Regression Tool' };

type Params = Promise<{ slug: string }>;
type SearchParams = Promise<{ keep?: string }>;

const DEFAULT_KEEP = 10;
const ACTIVE = ['queued', 'running', 'deleting'];

function formatTime(iso: string) {
  return `${new Date(iso).toISOString().replace('T', ' ').slice(0, 16)} UTC`;
}

function parseKeep(value: string | undefined): number {
  const keep = Number(value);
  return Number.isInteger(keep) && keep >= 0 && keep <= 1000 ? keep : DEFAULT_KEEP;
}

/** `bar()` of prototype `storage.js` as a meter against the 10 GB free tier. */
function UsageBar({ bytes }: { bytes: number }) {
  const pct = (bytes / FREE_TIER_BYTES) * 100;
  return (
    <div className="grid gap-1">
      <div
        role="meter"
        aria-label="Free tier usage"
        aria-valuemin={0}
        aria-valuemax={FREE_TIER_BYTES}
        aria-valuenow={Math.min(bytes, FREE_TIER_BYTES)}
        aria-valuetext={`${pct.toFixed(1)}% of ${formatBytes(FREE_TIER_BYTES)}`}
        className="h-3 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={pct > 90 ? 'h-full bg-destructive' : 'h-full bg-primary'}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <p className="text-sm text-muted-foreground tabular-nums">
        {formatBytes(bytes)} / {formatBytes(FREE_TIER_BYTES)} free tier ({pct.toFixed(1)}%) ·
        remaining {formatBytes(Math.max(0, FREE_TIER_BYTES - bytes))}
      </p>
    </div>
  );
}

function UsageCard({ usage }: { usage: StorageUsageRow | null }) {
  if (!usage || (usage.status === 'running' && !usage.refreshedAt)) {
    return (
      <p className="text-sm text-muted-foreground">
        {usage
          ? 'Listing the bucket… the numbers appear when it finishes.'
          : 'Storage has not been measured yet. Refresh to list the bucket.'}
      </p>
    );
  }
  return (
    <div className="grid gap-4">
      {usage.status === 'failed' && (
        <p role="alert" className="text-sm text-destructive">
          The last refresh failed: {usage.error}
        </p>
      )}
      <UsageBar bytes={usage.totalBytes} />
      <table className="w-full max-w-md text-sm">
        <caption className="sr-only">Storage by prefix</caption>
        <thead className="text-left">
          <tr>
            <th scope="col" className="py-1 font-medium">
              Prefix
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              Size
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              Objects
            </th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {usage.groups.map((g) => (
            <tr key={g.prefix} className="border-t">
              <td className="py-1 font-mono">{g.prefix}</td>
              <td className="py-1 text-right">{formatBytes(g.bytes)}</td>
              <td className="py-1 text-right">{g.objects}</td>
            </tr>
          ))}
          <tr className="border-t font-medium">
            <td className="py-1">Total</td>
            <td className="py-1 text-right">{formatBytes(usage.totalBytes)}</td>
            <td className="py-1 text-right">{usage.objectCount}</td>
          </tr>
        </tbody>
      </table>
      {usage.refreshedAt && (
        <p className="text-xs text-muted-foreground">
          Bucket <span className="font-mono">{usage.bucket}</span>, listed{' '}
          <time dateTime={usage.refreshedAt}>{formatTime(usage.refreshedAt)}</time>
        </p>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const destructive = status === 'failed' || status === 'delete_failed';
  return (
    <Badge
      variant={destructive ? undefined : 'secondary'}
      className={destructive ? 'border-transparent bg-destructive text-white' : undefined}
    >
      {status}
    </Badge>
  );
}

function RunActions({ run, archived }: { run: StorageRun; archived: boolean }) {
  if (run.isBaseline) {
    return <span className="text-xs text-muted-foreground">baseline, set another to delete</span>;
  }
  if (ACTIVE.includes(run.status)) return null;
  return (
    <DeleteEntityButton
      entity="run"
      id={run.id}
      label={run.label}
      retry={run.status === 'delete_failed'}
      disabled={archived}
      disabledReason="The project is archived"
    />
  );
}

/** Storage (F-STORAGE-1/2/3/5): usage by prefix, run sizes, delete and retention proposals. */
export default async function StoragePage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { slug } = await params;
  const keep = parseKeep((await searchParams).keep);
  const user = await requireUser();
  const project = await getProjectDetail(slug);
  if (!project) notFound();
  if (!(await canDo(user, 'project.settings', project.id))) forbidden();
  const [usage, runs, comparisons] = await Promise.all([
    getStorageUsage(project.id),
    listStorageRuns(project.id),
    listStorageComparisons(project.id),
  ]);
  const archived = Boolean(project.archivedAt);
  const proposals = retentionProposals(
    runs.filter((r) => !ACTIVE.includes(r.status)),
    keep,
  );
  const proposedBytes = proposals.reduce((sum, r) => sum + r.bytes, 0);

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Storage</h1>
          <p className="text-sm text-muted-foreground">
            R2 usage of this project&apos;s bucket, run sizes and cleanup.
          </p>
        </div>
        <RefreshStorageButton projectId={project.id} running={usage?.status === 'running'} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Bucket usage</h2>
          </CardTitle>
          <CardDescription>Bytes and objects by top-level prefix.</CardDescription>
        </CardHeader>
        <CardContent>
          <UsageCard usage={usage} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Runs</h2>
          </CardTitle>
          <CardDescription>
            Size is the sum of the run&apos;s stored items. Deleting a run also deletes the
            comparisons that use it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No runs yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <caption className="sr-only">Runs with their size</caption>
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Run
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Status
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Size
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Objects
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id} className="border-t">
                      <td className="px-3 py-2">
                        <span className="font-mono">{run.label}</span>
                        {run.isBaseline && (
                          <Badge variant="outline" className="ml-2">
                            baseline
                          </Badge>
                        )}
                        {run.note && (
                          <span className="block text-xs text-muted-foreground">{run.note}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={run.status} />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatBytes(run.bytes)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{run.objects}</td>
                      <td className="px-3 py-2 text-right">
                        <RunActions run={run} archived={archived} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {runs.length === STORAGE_LIST_LIMIT && (
            <p className="mt-2 text-sm text-muted-foreground">
              Showing the newest {STORAGE_LIST_LIMIT} runs.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Comparisons</h2>
          </CardTitle>
          <CardDescription>
            Deleting a comparison removes its diff images and report.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {comparisons.length === 0 ? (
            <p className="text-sm text-muted-foreground">No comparisons yet.</p>
          ) : (
            <ul className="grid gap-2">
              {comparisons.map((cmp) => (
                <li key={cmp.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-sm">{cmp.label}</span>
                    <StatusBadge status={cmp.status} />
                  </span>
                  {!ACTIVE.includes(cmp.status) && (
                    <DeleteEntityButton
                      entity="comparison"
                      id={cmp.id}
                      label={cmp.label}
                      retry={cmp.status === 'delete_failed'}
                      disabled={archived}
                      disabledReason="The project is archived"
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Retention</h2>
          </CardTitle>
          <CardDescription>
            Keeping the newest runs, older non-baseline runs are proposed for deletion. Nothing is
            deleted automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <form method="get" className="flex items-end gap-3">
            <div className="grid gap-2">
              <Label htmlFor="retention-keep">Keep the last N runs</Label>
              <Input
                id="retention-keep"
                name="keep"
                type="number"
                min={0}
                max={1000}
                defaultValue={keep}
                className="w-28"
              />
            </div>
            <Button type="submit" variant="outline">
              Show proposals
            </Button>
          </form>
          {proposals.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing to propose: the project has at most {keep} non-baseline runs.
            </p>
          ) : (
            <div className="grid gap-2">
              <p className="text-sm">
                {proposals.length} run{proposals.length === 1 ? '' : 's'} (
                {formatBytes(proposedBytes)}) could be deleted:
              </p>
              <ul className="grid gap-2">
                {proposals.map((run) => (
                  <li key={run.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-sm">
                      {run.label}{' '}
                      <span className="text-muted-foreground">({formatBytes(run.bytes)})</span>
                    </span>
                    <RunActions run={run} archived={archived} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
