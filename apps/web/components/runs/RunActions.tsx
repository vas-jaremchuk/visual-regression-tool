'use client';

import { Ban, Flag, GitCompare, Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { BASELINE_RUN_STATUSES, RETRYABLE_RUN_STATUSES, isActiveRun } from '@/lib/runs/progress';
import type { RunStatus } from '@vrt/shared';

type Action = 'cancel' | 'retry-failed' | 'baseline';

const DONE: Record<Action, string> = {
  cancel: 'Cancel requested',
  'retry-failed': 'Retrying failed items',
  baseline: 'Run set as baseline',
};

/**
 * F-RUN-4 actions of the run detail, rendered for editors and project admins only. Compare and
 * delete are placeholders until the comparison (T15) and delete (T22) tickets ship.
 */
export function RunActions({
  runId,
  status,
  failedItems,
  cancelRequested,
  isBaseline,
  canDelete,
}: {
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
      const res = await fetch(`/api/runs/${runId}/${action}`, {
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
      router.refresh();
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
  const soon = 'Available once comparisons are supported';

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
          <Button variant="outline" disabled title={soon}>
            <GitCompare aria-hidden />
            Compare with baseline
          </Button>
          <Button variant="outline" disabled title={soon}>
            <GitCompare aria-hidden />
            Compare with…
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
