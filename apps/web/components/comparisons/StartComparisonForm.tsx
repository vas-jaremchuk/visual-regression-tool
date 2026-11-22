'use client';

import { GitCompare, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { selectClassName } from '@/components/members/role-select-class';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

export interface RunOption {
  id: string;
  label: string;
  baseline: boolean;
}

interface ErrorBody {
  error?: {
    message?: string;
    details?: { replaceRequired?: boolean; comparison?: { label?: string } };
  };
}

/**
 * F-CMP-1: picks the before/after runs and starts the comparison through
 * `POST /api/projects/:id/comparisons`. Re-running a compared pair asks for confirmation first.
 */
export function StartComparisonForm({
  projectId,
  runs,
  defaults,
  disabled,
}: {
  projectId: string;
  runs: RunOption[];
  defaults: { beforeRunId: string; afterRunId: string };
  disabled?: boolean;
}) {
  const router = useRouter();
  const [before, setBefore] = useState(defaults.beforeRunId);
  const [after, setAfter] = useState(defaults.afterRunId);
  const [pending, setPending] = useState(false);
  const [confirmLabel, setConfirmLabel] = useState<string | null>(null);

  async function start(replace: boolean) {
    setPending(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/comparisons`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ beforeRunId: before, afterRunId: after, replace }),
      });
      const body = (await res.json().catch(() => null)) as (ErrorBody & { label?: string }) | null;
      if (res.status === 409 && body?.error?.details?.replaceRequired) {
        setConfirmLabel(body.error.details.comparison?.label ?? '');
        return;
      }
      if (!res.ok) {
        toast.error(body?.error?.message ?? 'Could not start the comparison');
        return;
      }
      setConfirmLabel(null);
      toast.success(`Comparison ${body?.label ?? ''} started`);
      router.refresh();
    } catch {
      toast.error('Could not reach the server. Try again.');
    } finally {
      setPending(false);
    }
  }

  const option = (run: RunOption) => (
    <option key={run.id} value={run.id}>
      {run.label}
      {run.baseline ? ' (baseline)' : ''}
    </option>
  );

  return (
    <>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void start(false);
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor="compare-before">Before run</Label>
          <select
            id="compare-before"
            className={selectClassName}
            value={before}
            onChange={(event) => setBefore(event.target.value)}
          >
            {runs.map(option)}
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="compare-after">After run</Label>
          <select
            id="compare-after"
            className={selectClassName}
            value={after}
            onChange={(event) => setAfter(event.target.value)}
          >
            {runs.map(option)}
          </select>
        </div>
        <Button type="submit" disabled={disabled || pending || before === after}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <GitCompare aria-hidden />}
          Compare
        </Button>
      </form>

      <Dialog open={confirmLabel !== null} onOpenChange={(open) => !open && setConfirmLabel(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace the earlier results?</DialogTitle>
            <DialogDescription>
              These runs were compared already{confirmLabel ? ` (${confirmLabel})` : ''}. Running
              the comparison again replaces its items and reviews.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmLabel(null)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={() => void start(true)} disabled={pending}>
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              Replace results
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
