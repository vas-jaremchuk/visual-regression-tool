import { Badge } from '@/components/ui/badge';

const STYLES: Record<string, string> = {
  queued: 'border-transparent bg-slate-600 text-white',
  running: 'border-transparent bg-blue-600 text-white',
  completed: 'border-transparent bg-emerald-600 text-white',
  completed_with_errors: 'border-transparent bg-amber-600 text-white',
  failed: 'border-transparent bg-destructive text-white',
  cancelled: 'border-transparent bg-zinc-500 text-white',
  deleting: 'border-transparent bg-zinc-500 text-white',
  delete_failed: 'border-transparent bg-destructive text-white',
  pending: '',
  processing: 'border-transparent bg-blue-600 text-white',
  done: 'border-transparent bg-emerald-600 text-white',
  skipped: '',
};

/** Run or item status with its text, so colour is never the only signal (08 §5). */
export function RunStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={STYLES[status] ? 'default' : 'outline'} className={STYLES[status]}>
      {status.replace(/_/g, ' ')}
    </Badge>
  );
}
