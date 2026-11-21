'use client';

import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { addManualUrlAction, removeManualUrlAction } from '@/app/(app)/p/[slug]/sitemap/actions';
import { useAction } from '@/components/members/use-action';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ManualUrlRow } from '@/lib/sitemap/queries';

/** F-SITEMAP-4: manual URLs merged into every snapshot. Editors add and remove them. */
export function ManualUrlsPanel({
  projectId,
  urls,
  canEdit,
}: {
  projectId: string;
  urls: ManualUrlRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, run] = useAction();
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');

  function add(event: React.FormEvent) {
    event.preventDefault();
    run(
      () => addManualUrlAction({ projectId, url, note: note.trim() || undefined }),
      () => {
        setUrl('');
        setNote('');
        router.refresh();
      },
    );
  }

  return (
    <div className="grid gap-4">
      {urls.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No manual URLs. They are added to every snapshot in addition to the sitemap.
        </p>
      ) : (
        <ul aria-label="Manual URLs" className="grid gap-1 text-sm">
          {urls.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-2">
              <span className="min-w-0">
                <span className="font-mono break-all">{row.url}</span>
                {row.note && <span className="text-muted-foreground"> · {row.note}</span>}
              </span>
              {canEdit && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${row.url}`}
                  disabled={pending}
                  onClick={() =>
                    run(() => removeManualUrlAction({ projectId, id: row.id }), router.refresh)
                  }
                >
                  <Trash2 aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <form onSubmit={add} className="grid gap-2 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
          <div className="grid gap-1">
            <Label htmlFor="manual-url">URL</Label>
            <Input
              id="manual-url"
              type="url"
              required
              placeholder="https://www.example.com/page"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="manual-note">Note (optional)</Label>
            <Input
              id="manual-note"
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          <Button type="submit" disabled={pending || url.trim() === ''}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
            Add URL
          </Button>
        </form>
      )}
    </div>
  );
}
