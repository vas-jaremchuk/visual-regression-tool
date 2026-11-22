'use client';

import { Loader2, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * Re-diff (09 §1, F-IGNORE-3): re-runs the comparison with the project's current thresholds and
 * ignore rules. Editor+, only when the comparison is not running.
 */
export function RediffButton({
  comparisonId,
  disabled,
}: {
  comparisonId: string;
  disabled: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function rediff() {
    setPending(true);
    try {
      const response = await fetch(`/api/comparisons/${comparisonId}/rediff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const body = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      if (!response.ok) {
        toast.error(body?.error?.message ?? 'Could not re-diff the comparison. Try again.');
        return;
      }
      toast.success('Re-diff started');
      setOpen(false);
      router.refresh();
    } catch {
      toast.error('Could not reach the server. Try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" disabled={disabled} onClick={() => setOpen(true)}>
        <RefreshCw aria-hidden />
        Re-diff
      </Button>
      <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Re-diff with the current rules?</DialogTitle>
            <DialogDescription>
              The comparison runs again with the project&apos;s current thresholds and ignore rules.
              Its items are replaced; remembered approvals and ignores are applied again, other
              reviews and notes are lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={() => void rediff()} disabled={pending}>
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              Re-diff
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
