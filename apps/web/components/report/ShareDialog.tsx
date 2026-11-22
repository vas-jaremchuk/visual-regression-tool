'use client';

import { SHARE_LINK_DEFAULT_DAYS } from '@vrt/shared';
import { Copy, Link2, Loader2, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Pending = 'create' | 'revoke' | null;

/**
 * *Share* on the report (04 §5, 08 §3), editor+. Creates a public read-only link with an expiry,
 * or revokes it. Only the token's hash is stored, so the URL is shown once, right after creating.
 */
export function ShareDialog({
  comparisonId,
  active,
  expiresAt,
}: {
  comparisonId: string;
  active: boolean;
  expiresAt: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(String(SHARE_LINK_DEFAULT_DAYS));
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ url: string; expiresAt: string } | null>(null);

  async function call(method: 'POST' | 'DELETE') {
    const res = await fetch(`/api/comparisons/${comparisonId}/share`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'POST' ? JSON.stringify({ expiresInDays: Number(days) }) : '{}',
    });
    const body = (await res.json().catch(() => null)) as {
      url?: string;
      expiresAt?: string;
      error?: { message?: string };
    } | null;
    if (!res.ok) throw new Error(body?.error?.message ?? 'The action failed');
    return body;
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    setPending('create');
    setError(null);
    try {
      const body = await call('POST');
      if (body?.url && body.expiresAt) setCreated({ url: body.url, expiresAt: body.expiresAt });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the server. Try again.');
    } finally {
      setPending(null);
    }
  }

  async function revoke() {
    setPending('revoke');
    setError(null);
    try {
      await call('DELETE');
      setCreated(null);
      toast.success('Share link revoked');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the server. Try again.');
    } finally {
      setPending(null);
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied');
    } catch {
      toast.error('Copy failed; select the link and copy it.');
    }
  }

  const live = created ?? (active ? { url: null, expiresAt } : null);
  const liveUrl = live?.url ?? null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setCreated(null);
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Link2 aria-hidden />
          Share
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share read-only link</DialogTitle>
          <DialogDescription>
            Anyone with the link can view this report without signing in. They see no other page of
            the project and cannot review.
          </DialogDescription>
        </DialogHeader>

        {live && (
          <div className="grid gap-2 rounded-md border p-3 text-sm" data-testid="share-status">
            <p>
              A link is active
              {live.expiresAt && (
                <>
                  {' '}
                  until{' '}
                  <time dateTime={live.expiresAt}>
                    {new Date(live.expiresAt).toLocaleString('en')}
                  </time>
                </>
              )}
              .
            </p>
            {liveUrl ? (
              <div className="flex gap-2">
                <Label htmlFor="share-url" className="sr-only">
                  Share link
                </Label>
                <Input id="share-url" readOnly value={liveUrl} onFocus={(e) => e.target.select()} />
                <Button type="button" variant="outline" size="sm" onClick={() => copy(liveUrl)}>
                  <Copy aria-hidden />
                  Copy
                </Button>
              </div>
            ) : (
              <p className="text-muted-foreground">
                The link is shown only when it is created. Create a new one to get a URL; the old
                link stops working.
              </p>
            )}
          </div>
        )}

        <form onSubmit={create} className="grid gap-3">
          <div className="grid gap-1">
            <Label htmlFor="share-days">Expires after (days)</Label>
            <Input
              id="share-days"
              type="number"
              min={1}
              max={365}
              required
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className="w-32"
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter className="gap-2">
            {live && (
              <Button
                type="button"
                variant="destructive"
                onClick={revoke}
                disabled={pending !== null}
              >
                {pending === 'revoke' ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <Trash2 aria-hidden />
                )}
                Revoke link
              </Button>
            )}
            <Button type="submit" disabled={pending !== null}>
              {pending === 'create' && <Loader2 className="animate-spin" aria-hidden />}
              {live ? 'Create new link' : 'Create link'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
