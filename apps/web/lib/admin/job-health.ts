/**
 * Job health rules (F-ADMIN-3, NFR-27). Pure, so the stuck rule is tested without a database;
 * `queries.ts` loads the rows.
 */

/** An active job without progress for longer than this is shown as a warning. */
export const STUCK_AFTER_MS = 15 * 60_000;

export interface ActiveJobInput {
  kind: 'run' | 'comparison';
  id: string;
  label: string;
  status: string;
  projectName: string;
  projectSlug: string;
  totalItems: number | null;
  doneItems: number | null;
  failedItems: number | null;
  createdAt: string;
  startedAt: string | null;
  /** Newest item progress (run_items.finished_at), when known. */
  lastItemAt: string | null;
}

export interface ActiveJob extends ActiveJobInput {
  lastProgressAt: string;
  stuck: boolean;
}

/** Last sign of life: the newest finished item, else the start, else the creation. */
export function lastProgressAt(
  job: Pick<ActiveJobInput, 'createdAt' | 'startedAt' | 'lastItemAt'>,
) {
  const times = [job.createdAt, job.startedAt, job.lastItemAt].filter(
    (value): value is string => value !== null,
  );
  return times.reduce((latest, value) => (Date.parse(value) > Date.parse(latest) ? value : latest));
}

export function isStuck(lastProgress: string, now: Date): boolean {
  return now.getTime() - Date.parse(lastProgress) > STUCK_AFTER_MS;
}

/** Active jobs with their stuck flag, stuck ones first, then oldest progress first. */
export function assessActiveJobs(jobs: ActiveJobInput[], now: Date): ActiveJob[] {
  return jobs
    .map((job) => {
      const last = lastProgressAt(job);
      return { ...job, lastProgressAt: last, stuck: isStuck(last, now) };
    })
    .sort(
      (a, b) =>
        Number(b.stuck) - Number(a.stuck) ||
        Date.parse(a.lastProgressAt) - Date.parse(b.lastProgressAt),
    );
}
