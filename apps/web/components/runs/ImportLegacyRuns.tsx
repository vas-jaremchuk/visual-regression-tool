'use client';

import { History, Loader2 } from 'lucide-react';
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
  DialogTrigger,
} from '@/components/ui/dialog';

type Listing =
  { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; labels: string[] };

async function post(projectId: string, body: unknown) {
  const res = await fetch(`/api/projects/${projectId}/import-legacy`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as {
    labels?: string[];
    workflowId?: string;
    error?: { message?: string };
  } | null;
  return { ok: res.ok, json };
}

/**
 * F-RUN-6: *Import existing runs* lists the bucket's `screenshots/<ts>/` prefixes in prototype
 * layout that are not runs yet, and imports the selected ones as legacy runs.
 */
export function ImportLegacyRuns({
  projectId,
  disabled,
}: {
  projectId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [listing, setListing] = useState<Listing>({ state: 'loading' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);

  async function load() {
    setListing({ state: 'loading' });
    setSelected(new Set());
    try {
      const { ok, json } = await post(projectId, { action: 'list' });
      if (!ok || !json?.labels) {
        setListing({
          state: 'error',
          message: json?.error?.message ?? 'Could not list the bucket',
        });
        return;
      }
      setListing({ state: 'ready', labels: json.labels });
      setSelected(new Set(json.labels));
    } catch {
      setListing({ state: 'error', message: 'Could not reach the server. Try again.' });
    }
  }

  async function importSelected() {
    setImporting(true);
    try {
      const labels = [...selected].sort();
      const { ok, json } = await post(projectId, { action: 'import', labels });
      if (!ok) {
        toast.error(json?.error?.message ?? 'Could not start the import');
        return;
      }
      toast.success(`Importing ${labels.length} run${labels.length === 1 ? '' : 's'}`);
      setOpen(false);
      router.refresh();
    } catch {
      toast.error('Could not reach the server. Try again.');
    } finally {
      setImporting(false);
    }
  }

  function toggle(label: string, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(label);
    else next.delete(label);
    setSelected(next);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void load();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          <History aria-hidden />
          Import existing runs
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import existing runs</DialogTitle>
          <DialogDescription>
            Runs the prototype stored in the bucket under{' '}
            <code>screenshots/&lt;timestamp&gt;/</code>. Screenshots are imported as the{' '}
            <code>desktop</code> viewport; URLs come from the latest sitemap snapshot, and unknown
            ones are shown by filename.
          </DialogDescription>
        </DialogHeader>
        {listing.state === 'loading' && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Listing the bucket…
          </p>
        )}
        {listing.state === 'error' && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-destructive">{listing.message}</span>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        )}
        {listing.state === 'ready' && listing.labels.length === 0 && (
          <p className="text-sm text-muted-foreground">No prototype runs left to import.</p>
        )}
        {listing.state === 'ready' && listing.labels.length > 0 && (
          <fieldset className="grid max-h-72 gap-2 overflow-y-auto">
            <legend className="mb-2 text-sm font-medium">Prototype runs</legend>
            {listing.labels.map((label) => (
              <label key={label} className="flex items-center gap-2 font-mono text-sm">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={selected.has(label)}
                  onChange={(e) => toggle(label, e.target.checked)}
                />
                {label}
              </label>
            ))}
          </fieldset>
        )}
        <DialogFooter>
          <Button
            onClick={importSelected}
            disabled={listing.state !== 'ready' || selected.size === 0 || importing}
          >
            {importing && <Loader2 className="animate-spin" aria-hidden />}
            Import {selected.size} run{selected.size === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
