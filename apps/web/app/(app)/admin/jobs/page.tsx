import { AlertTriangle } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { RunStatusBadge } from '@/components/runs/RunStatusBadge';
import { formatTime } from '@/components/runs/format';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { DlqCount } from '@/lib/admin/dlq';
import { STUCK_AFTER_MS, type ActiveJob } from '@/lib/admin/job-health';
import {
  getDlqCounts,
  getJobHealth,
  type ItemError,
  type RecentFailure,
} from '@/lib/admin/queries';
import { requireUser } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Jobs · Visual Regression Tool' };
export const dynamic = 'force-dynamic';

function jobHref(job: { kind: 'run' | 'comparison'; projectSlug: string; label: string }) {
  if (!job.projectSlug) return null;
  return job.kind === 'run'
    ? `/p/${job.projectSlug}/runs/${job.label}`
    : `/p/${job.projectSlug}/comparisons`;
}

function JobLink(job: { kind: 'run' | 'comparison'; projectSlug: string; label: string }) {
  const href = jobHref(job);
  return href ? (
    <Link href={href} className="font-mono underline-offset-4 hover:underline">
      {job.label}
    </Link>
  ) : (
    <span className="font-mono">{job.label}</span>
  );
}

function Section({
  title,
  description,
  empty,
  children,
}: {
  title: string;
  description: string;
  empty: string | null;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{title}</h2>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {empty ? <p className="text-sm text-muted-foreground">{empty}</p> : children}
      </CardContent>
    </Card>
  );
}

function Table({
  caption,
  headers,
  children,
}: {
  caption: string;
  headers: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-muted/50 text-left">
          <tr>
            {headers.map((h) => (
              <th key={h} scope="col" className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function ActiveJobs({ jobs }: { jobs: ActiveJob[] }) {
  return (
    <Table
      caption="Active runs and comparisons"
      headers={['Job', 'Project', 'Status', 'Progress', 'Last progress']}
    >
      {jobs.map((job) => (
        <tr key={`${job.kind}-${job.id}`} className="border-t align-top">
          <td className="px-3 py-2">
            <span className="mr-2 text-xs text-muted-foreground">{job.kind}</span>
            <JobLink {...job} />
          </td>
          <td className="px-3 py-2">{job.projectName}</td>
          <td className="px-3 py-2">
            <div className="flex flex-wrap gap-1">
              <RunStatusBadge status={job.status} />
              {job.stuck && (
                <Badge className="border-transparent bg-amber-600 text-white">
                  <AlertTriangle className="size-3" aria-hidden />
                  stuck
                </Badge>
              )}
            </div>
          </td>
          <td className="px-3 py-2 tabular-nums">
            {job.totalItems === null ? (
              '—'
            ) : (
              <>
                {job.doneItems}/{job.totalItems}
                {(job.failedItems ?? 0) > 0 && (
                  <span className="text-destructive"> · {job.failedItems} failed</span>
                )}
              </>
            )}
          </td>
          <td className="px-3 py-2 whitespace-nowrap tabular-nums">
            {formatTime(job.lastProgressAt)}
          </td>
        </tr>
      ))}
    </Table>
  );
}

function Failures({ failures }: { failures: RecentFailure[] }) {
  return (
    <Table
      caption="Recent failed runs and comparisons"
      headers={['Job', 'Project', 'Status', 'Finished']}
    >
      {failures.map((job) => (
        <tr key={`${job.kind}-${job.id}`} className="border-t align-top">
          <td className="px-3 py-2">
            <span className="mr-2 text-xs text-muted-foreground">{job.kind}</span>
            <JobLink {...job} />
          </td>
          <td className="px-3 py-2">{job.projectName}</td>
          <td className="px-3 py-2">
            <RunStatusBadge status={job.status} />
          </td>
          <td className="px-3 py-2 whitespace-nowrap tabular-nums">
            {job.finishedAt ? formatTime(job.finishedAt) : '—'}
          </td>
        </tr>
      ))}
    </Table>
  );
}

function Errors({ errors }: { errors: ItemError[] }) {
  return (
    <Table caption="Last item errors" headers={['Run', 'Project', 'URL', 'Error', 'When']}>
      {errors.map((item, index) => (
        <tr key={index} className="border-t align-top">
          <td className="px-3 py-2">
            <JobLink kind="run" projectSlug={item.projectSlug} label={item.runLabel} />
          </td>
          <td className="px-3 py-2">{item.projectName}</td>
          <td className="px-3 py-2 break-all">{item.url}</td>
          <td className="px-3 py-2 break-all text-destructive">{item.error}</td>
          <td className="px-3 py-2 whitespace-nowrap tabular-nums">
            {item.finishedAt ? formatTime(item.finishedAt) : '—'}
          </td>
        </tr>
      ))}
    </Table>
  );
}

function DeadLetters({ counts }: { counts: DlqCount[] }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {counts.map((dlq) => (
        <li key={dlq.queue} className="rounded-md border p-3">
          <p className="font-mono text-sm">{dlq.queue}</p>
          {dlq.messages === null ? (
            <p role="alert" className="text-sm text-destructive">
              Unavailable: {dlq.error}
            </p>
          ) : (
            <p className="text-sm">
              <span
                className={
                  dlq.messages > 0
                    ? 'text-2xl font-semibold text-destructive'
                    : 'text-2xl font-semibold'
                }
              >
                {dlq.messages}
              </span>{' '}
              {dlq.messages === 1 ? 'message' : 'messages'}
              {dlq.oldestMessageAt && (
                <span className="block text-xs text-muted-foreground">
                  oldest {formatTime(dlq.oldestMessageAt)}
                </span>
              )}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Admin → Jobs (F-ADMIN-3, NFR-27, 06 §8). Platform admins only. */
export default async function JobsPage() {
  const user = await requireUser();
  if (!user.isPlatformAdmin) notFound();
  const [health, dlq] = await Promise.all([getJobHealth(), getDlqCounts()]);
  const stuck = health.active.filter((job) => job.stuck).length;
  const minutes = STUCK_AFTER_MS / 60_000;
  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Jobs</h1>
        <p className="text-sm text-muted-foreground">
          Runs and comparisons across every project, recent failures and dead letter queues.
        </p>
      </div>
      {stuck > 0 && (
        <p
          role="alert"
          className="flex items-center gap-2 rounded-md border border-amber-600 p-3 text-sm"
        >
          <AlertTriangle className="size-4 text-amber-600" aria-hidden />
          {stuck === 1 ? '1 job has' : `${stuck} jobs have`} made no progress for more than{' '}
          {minutes} minutes.
        </p>
      )}
      <Section
        title="Active jobs"
        description={`Queued and running jobs. A job with no progress for more than ${minutes} minutes is marked stuck.`}
        empty={health.active.length === 0 ? 'No runs or comparisons are active.' : null}
      >
        <ActiveJobs jobs={health.active} />
      </Section>
      <Section
        title="Dead letter queues"
        description="Queue messages that failed every retry (Cloudflare Queues)."
        empty={null}
      >
        <DeadLetters counts={dlq} />
      </Section>
      <Section
        title="Recent failures"
        description="Runs and comparisons that failed or finished with errors."
        empty={health.failures.length === 0 ? 'No failed runs or comparisons.' : null}
      >
        <Failures failures={health.failures} />
      </Section>
      <Section
        title="Last errors"
        description="The newest failed capture items with their error message."
        empty={health.errors.length === 0 ? 'No item errors.' : null}
      >
        <Errors errors={health.errors} />
      </Section>
    </div>
  );
}
