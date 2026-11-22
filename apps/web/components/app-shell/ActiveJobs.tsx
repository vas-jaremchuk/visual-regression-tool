'use client';

import { Activity, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { isActiveRun, percentOf, type ActiveJob } from '@/lib/runs/progress';
import { createClient } from '@/lib/supabase/client';
import type { ProjectSummary } from './types';

type Row = Record<string, unknown> & { id: string; project_id: string; status: string };

function upsert(jobs: ActiveJob[], job: ActiveJob, active: boolean): ActiveJob[] {
  const rest = jobs.filter((j) => !(j.kind === job.kind && j.id === job.id));
  return active ? [...rest, job] : rest;
}

/**
 * 08 §2 / §4: global active-job indicator in the top bar. Starts from the server's list and
 * follows Realtime changes of `runs` and `sitemap_snapshots` rows (RLS limits them to the
 * user's projects), so it persists while the user navigates.
 */
export function ActiveJobs({
  initial,
  projects,
}: {
  initial: ActiveJob[];
  projects: ProjectSummary[];
}) {
  const [jobs, setJobs] = useState(initial);

  const [shown, setShown] = useState(initial);
  if (initial !== shown) {
    setShown(initial);
    setJobs(initial);
  }

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel('active-jobs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'runs' }, (payload) => {
        if (payload.eventType === 'DELETE') {
          const id = (payload.old as { id?: string }).id;
          setJobs((current) => current.filter((j) => !(j.kind === 'run' && j.id === id)));
          return;
        }
        const row = payload.new as Row;
        const job: ActiveJob = {
          kind: 'run',
          id: row.id,
          projectId: row.project_id,
          label: String(row.label),
          status: row.status,
          done: Number(row.done_items) + Number(row.failed_items),
          total: Number(row.total_items),
        };
        setJobs((current) => upsert(current, job, isActiveRun(row.status)));
      })
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sitemap_snapshots' },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const id = (payload.old as { id?: string }).id;
            setJobs((current) => current.filter((j) => !(j.kind === 'snapshot' && j.id === id)));
            return;
          }
          const row = payload.new as Row;
          const job: ActiveJob = {
            kind: 'snapshot',
            id: row.id,
            projectId: row.project_id,
            label: 'Sitemap fetch',
            status: row.status,
            done: Number(row.urls_checked),
            total: Number(row.urls_total),
          };
          setJobs((current) => upsert(current, job, row.status === 'running'));
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  const slugOf = new Map(projects.map((p) => [p.id, p]));
  const count = jobs.length;
  const label = count === 0 ? 'No active jobs' : `${count} active job${count === 1 ? '' : 's'}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={label} className="gap-2">
          {count > 0 ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Activity className="size-4" aria-hidden />
          )}
          <span className="tabular-nums">{count}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        {count > 0 && <DropdownMenuSeparator />}
        {jobs.map((job) => {
          const project = slugOf.get(job.projectId);
          const href = project
            ? job.kind === 'run'
              ? `/p/${project.slug}/runs/${job.label}`
              : `/p/${project.slug}/sitemap`
            : '/';
          return (
            <DropdownMenuItem key={`${job.kind}-${job.id}`} asChild>
              <Link href={href} className="grid gap-1">
                <span className="flex justify-between gap-2 text-sm">
                  <span className="truncate font-medium">
                    {project?.name ?? 'Project'} · {job.label}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {job.total > 0 ? `${job.done}/${job.total}` : job.status}
                  </span>
                </span>
                <span className="block h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full bg-primary"
                    style={{ width: `${percentOf(job.done, job.total)}%` }}
                  />
                </span>
              </Link>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
