'use client';

import { Ban, Flag, GitCompare, Loader2, RotateCcw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { BASELINE_RUN_STATUSES, RETRYABLE_RUN_STATUSES, isActiveRun } from '@/lib/runs/progress';
import type { RunStatus } from '@vrt/shared';

type Action = 'cancel' | 'retry-failed' | 'baseline' | 'compare';

const DONE: Record<Action, string> = {
  cancel: 'Cancel requested',
  'retry-failed': 'Retrying failed items',
  baseline: 'Run set as baseline',
  compare: 'Comparison with the baseline started',
};

/**
 * F-RUN-4 actions of the run detail, rendered for editors and project admins only. *Compare
 * with…* opens the comparisons page to pick the other run; delete is a placeholder until the
 * delete workflow (T22) ships.
 */
export function RunActions({
  projectId,
  slug,
  baselineRunId,
  runId,
  status,
  failedItems,
  cancelRequested,
  isBaseline,
  canDelete,
}: {
  projectId: string;
  slug: string;
  baselineRunId: string | null;
  runId: string;
  status: RunStatus;
  failedItems: number;
  cancelRequested: boolean;
  isBaseline: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<Action | null>(null);

  async function run(action: Action) {
    setPending(action);
    try {
      const res =
        action === 'compare'
          ? await fetch(`/api/projects/${projectId}/comparisons`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ beforeRunId: baselineRunId, afterRunId: runId }),
            })
          : await fetch(`/api/runs/${runId}/${action}`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: '{}',
            });
      const body = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      if (!res.ok) {
        toast.error(body?.error?.message ?? 'The action failed');
        return;
      }
      toast.success(DONE[action]);
      if (action === 'compare') router.push(`/p/${slug}/comparisons`);
      else router.refresh();
    } catch {
      toast.error('Could not reach the server. Try again.');
    } finally {
      setPending(null);
    }
  }

  const icon = (action: Action, Icon: typeof Ban) =>
    pending === action ? <Loader2 className="animate-spin" aria-hidden /> : <Icon aria-hidden />;
  const retryable = RETRYABLE_RUN_STATUSES.includes(status) && failedItems > 0;
  const baselineable = BASELINE_RUN_STATUSES.includes(status) && !isBaseline;

  return (
    <div className="flex flex-wrap gap-2">
      {isActiveRun(status) && (
        <Button
          variant="outline"
          onClick={() => run('cancel')}
          disabled={pending !== null || cancelRequested}
        >
          {icon('cancel', Ban)}
          {cancelRequested ? 'Cancelling…' : 'Cancel'}
        </Button>
      )}
      {retryable && (
        <Button variant="outline" onClick={() => run('retry-failed')} disabled={pending !== null}>
          {icon('retry-failed', RotateCcw)}
          Retry failed
        </Button>
      )}
      {BASELINE_RUN_STATUSES.includes(status) && (
        <>
          {baselineRunId && !isBaseline && (
            <Button variant="outline" onClick={() => run('compare')} disabled={pending !== null}>
              {icon('compare', GitCompare)}
              Compare with baseline
            </Button>
          )}
          <Button asChild variant="outline">
            <Link href={`/p/${slug}/comparisons`}>
              <GitCompare aria-hidden />
              Compare with…
            </Link>
          </Button>
        </>
      )}
      {baselineable && (
        <Button variant="outline" onClick={() => run('baseline')} disabled={pending !== null}>
          {icon('baseline', Flag)}
          Set as baseline
        </Button>
      )}
      {canDelete && (
        <Button variant="outline" disabled title="Deleting runs is not available yet">
          <Trash2 aria-hidden />
          Delete
        </Button>
      )}
    </div>
  );
}
