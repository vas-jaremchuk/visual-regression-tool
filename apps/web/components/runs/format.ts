import { formatDuration } from '@/lib/runs/progress';

export function formatTime(iso: string) {
  return `${new Date(iso).toISOString().replace('T', ' ').slice(0, 16)} UTC`;
}

/** Duration from start to finish, or to now while the run is going. */
export function runDuration(run: { startedAt: string | null; finishedAt: string | null }) {
  if (!run.startedAt) return '—';
  const end = run.finishedAt ? Date.parse(run.finishedAt) : Date.now();
  return formatDuration(end - Date.parse(run.startedAt));
}
