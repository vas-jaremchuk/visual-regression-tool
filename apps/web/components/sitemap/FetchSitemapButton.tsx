'use client';

import { ListTree, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

/** F-SITEMAP-1: starts a sitemap snapshot through `POST /api/projects/:id/sitemap`. */
export function FetchSitemapButton({
  projectId,
  disabled,
  variant = 'default',
}: {
  projectId: string;
  disabled?: boolean;
  variant?: 'default' | 'outline';
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function start() {
    setPending(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/sitemap`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      const body = (await res.json().catch(() => null)) as {
        snapshotId?: string;
        error?: { message?: string };
      } | null;
      if (!res.ok) {
        toast.error(body?.error?.message ?? 'Could not start the sitemap fetch');
        return;
      }
      toast.success('Sitemap fetch started');
      router.refresh();
    } catch {
      toast.error('Could not reach the server. Try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Button variant={variant} onClick={start} disabled={disabled || pending}>
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : <ListTree aria-hidden />}
      Fetch sitemap
    </Button>
  );
}
