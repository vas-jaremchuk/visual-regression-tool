'use client';

import { Loader2, RotateCcw, Trash2 } from 'lucide-react';
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

interface Preview {
  deleting: { comparisons: { id: string; label: string }[]; objects: number };
}

interface ErrorBody {
  error?: { message?: string };
}

/**
 * Delete (or retry a failed delete of) a run or comparison (F-RUN-4, F-STORAGE-3). Asks the API
 * for a preview first and lists exactly what will be deleted (08 §4) before confirming.
 */
export function DeleteEntityButton({
  entity,
  id,
  label,
  retry = false,
  disabled = false,
  disabledReason,
}: {
  entity: 'run' | 'comparison';
  id: string;
  label: string;
  retry?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const url = `/api/${entity === 'run' ? 'runs' : 'comparisons'}/${id}`;

  async function request(confirm: boolean) {
    setPending(true);
    try {
      const res = await fetch(confirm ? `${url}?confirm=true` : url, { method: 'DELETE' });
      const body = (await res.json().catch(() => null)) as (Preview & ErrorBody) | null;
      if (!res.ok || !body?.deleting) {
        toast.error(body?.error?.message ?? `Could not delete ${entity} ${label}`);
        return;
      }
      if (!confirm) {
        setPreview(body);
        return;
      }
      setPreview(null);
      toast.success(`Deleting ${entity} ${label}`);
      router.refresh();
    } catch {
      toast.error('Could not reach the server. Try again.');
    } finally {
      setPending(false);
    }
  }

  const action = retry ? 'Retry delete' : 'Delete';
  const others = entity === 'run' ? (preview?.deleting.comparisons ?? []) : [];

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant={retry ? 'outline' : 'destructive'}
        disabled={disabled || pending}
        title={disabled ? disabledReason : undefined}
        aria-label={`${action} ${entity} ${label}`}
        onClick={() => void request(false)}
      >
        {pending && !preview ? (
          <Loader2 className="animate-spin" aria-hidden />
        ) : retry ? (
          <RotateCcw aria-hidden />
        ) : (
          <Trash2 aria-hidden />
        )}
        {action}
      </Button>

      <Dialog open={preview !== null} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Delete {entity} {label}?
            </DialogTitle>
            <DialogDescription>
              This removes about {preview?.deleting.objects ?? 0} objects from R2 and the {entity}{' '}
              from the database. It cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {others.length > 0 && (
            <div className="grid gap-1 text-sm">
              <p>
                {others.length} comparison{others.length === 1 ? '' : 's'} using this run will be
                deleted too:
              </p>
              <ul className="max-h-48 list-disc overflow-y-auto pl-5 font-mono">
                {others.map((c) => (
                  <li key={c.id}>{c.label}</li>
                ))}
              </ul>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreview(null)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void request(true)} disabled={pending}>
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
