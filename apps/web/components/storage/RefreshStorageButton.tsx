'use client';

import { Loader2, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

/** *Refresh* (F-STORAGE-1): starts the StorageWorkflow through the refresh endpoint. */
export function RefreshStorageButton({
  projectId,
  running,
}: {
  projectId: string;
  running: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function refresh() {
    setPending(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/storage/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      const body = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      if (!res.ok) {
        toast.error(body?.error?.message ?? 'Could not refresh the storage usage');
        return;
      }
      toast.success('Storage refresh started; the numbers update when the listing finishes.');
      router.refresh();
    } catch {
      toast.error('Could not reach the server. Try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Button type="button" variant="outline" onClick={() => void refresh()} disabled={pending}>
      {pending || running ? (
        <Loader2 className="animate-spin" aria-hidden />
      ) : (
        <RefreshCw aria-hidden />
      )}
      {running ? 'Refreshing…' : 'Refresh'}
    </Button>
  );
}
