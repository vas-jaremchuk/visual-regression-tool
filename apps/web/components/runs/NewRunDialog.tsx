'use client';

import { Camera, ListChecks, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { selectClassName } from '@/components/members/role-select-class';
import { estimateRunMs, formatDuration } from '@/lib/runs/progress';

type Scope = 'all' | 'pages' | 'files' | 'custom' | 'sample';

const SCOPES: { value: Scope; label: string }[] = [
  { value: 'all', label: 'All included URLs' },
  { value: 'pages', label: 'Only pages' },
  { value: 'files', label: 'Only files' },
  { value: 'custom', label: 'Custom subset' },
  { value: 'sample', label: 'Random sample' },
];

export interface NewRunSnapshot {
  id: string;
  createdAt: string;
  urlCount: number;
}

export interface NewRunViewport {
  slug: string;
  width: number;
  height: number;
  enabled: boolean;
}

interface DryRunItem {
  url: string;
  kind: 'page' | 'file';
  viewportSlug: string | null;
  filename: string;
}

type Preview =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; items: DryRunItem[] }
  | { state: 'error'; message: string };

const PREVIEW_LIMIT = 200;

function formatTime(iso: string) {
  return `${new Date(iso).toISOString().replace('T', ' ').slice(0, 16)} UTC`;
}

interface ErrorBody {
  error?: { code?: string; message?: string; details?: { activeRun?: { url?: string } } };
}

/**
 * F-RUN-1: new run dialog. The estimate comes from a debounced dry run of the current selection
 * (`POST /api/projects/:id/runs` with `dryRun`); *Dry run* lists those items.
 */
export function NewRunDialog({
  projectId,
  slug,
  snapshots,
  viewports,
  concurrency,
  itemMs,
  disabled,
  variant = 'default',
}: {
  projectId: string;
  slug: string;
  snapshots: NewRunSnapshot[];
  viewports: NewRunViewport[];
  concurrency: number;
  itemMs: number;
  disabled?: boolean;
  variant?: 'default' | 'outline';
}) {
  const router = useRouter();
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [snapshotId, setSnapshotId] = useState(snapshots[0]?.id ?? '');
  const [selected, setSelected] = useState<string[]>(
    viewports.filter((v) => v.enabled).map((v) => v.slug),
  );
  const [scope, setScope] = useState<Scope>('all');
  const [customUrls, setCustomUrls] = useState('');
  const [sample, setSample] = useState('10');
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<Preview>({ state: 'idle' });
  const [showItems, setShowItems] = useState(false);
  const [pending, setPending] = useState(false);

  const urls = customUrls
    .split(/\s+/)
    .map((url) => url.trim())
    .filter(Boolean);
  const sampleSize = Number.parseInt(sample, 10);
  const invalid =
    !snapshotId ||
    selected.length === 0 ||
    (scope === 'custom' && urls.length === 0) ||
    (scope === 'sample' && !(sampleSize > 0));

  const body = {
    snapshotId,
    viewports: viewports.map((v) => v.slug).filter((s) => selected.includes(s)),
    scope,
    ...(scope === 'custom' ? { urls } : {}),
    ...(scope === 'sample' ? { sample: sampleSize } : {}),
    ...(note.trim() ? { note: note.trim() } : {}),
  };
  const selection = JSON.stringify({ ...body, note: undefined });

  useEffect(() => {
    if (!open || invalid) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setPreview({ state: 'loading' });
      try {
        const res = await fetch(`/api/projects/${projectId}/runs`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...JSON.parse(selection), dryRun: true }),
        });
        const json = (await res.json().catch(() => null)) as
          ({ items?: DryRunItem[] } & ErrorBody) | null;
        if (cancelled) return;
        if (!res.ok || !json?.items) {
          setPreview({
            state: 'error',
            message: json?.error?.message ?? 'Could not estimate this run',
          });
          return;
        }
        setPreview({ state: 'ready', items: json.items });
      } catch {
        if (!cancelled) setPreview({ state: 'error', message: 'Could not reach the server.' });
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, invalid, projectId, selection]);

  async function start() {
    setPending(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, dryRun: false }),
      });
      const json = (await res.json().catch(() => null)) as
        ({ runId?: string; label?: string } & ErrorBody) | null;
      if (!res.ok || !json?.label) {
        const active = json?.error?.details?.activeRun?.url;
        toast.error(json?.error?.message ?? 'Could not start the run', {
          action: active ? { label: 'Open', onClick: () => router.push(active) } : undefined,
        });
        return;
      }
      toast.success(`Run ${json.label} started`);
      setOpen(false);
      router.push(`/p/${slug}/runs/${json.label}`);
    } catch {
      toast.error('Could not reach the server. Try again.');
    } finally {
      setPending(false);
    }
  }

  function toggleViewport(viewportSlug: string, checked: boolean) {
    setSelected((current) =>
      checked ? [...current, viewportSlug] : current.filter((s) => s !== viewportSlug),
    );
  }

  const items = preview.state === 'ready' ? preview.items : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} disabled={disabled}>
          <Camera aria-hidden />
          New run
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New run</DialogTitle>
          <DialogDescription>
            Captures screenshots of the selected URLs for each selected viewport.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor={`${ids}-snapshot`}>Snapshot</Label>
            <select
              id={`${ids}-snapshot`}
              className={selectClassName}
              value={snapshotId}
              onChange={(e) => setSnapshotId(e.target.value)}
            >
              {snapshots.map((snapshot) => (
                <option key={snapshot.id} value={snapshot.id}>
                  {formatTime(snapshot.createdAt)} · {snapshot.urlCount} URLs
                </option>
              ))}
            </select>
          </div>

          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">Viewports</legend>
            <div className="flex flex-wrap gap-4">
              {viewports.map((viewport) => (
                <label key={viewport.slug} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={selected.includes(viewport.slug)}
                    onChange={(e) => toggleViewport(viewport.slug, e.target.checked)}
                  />
                  {viewport.slug}
                  <span className="text-muted-foreground">
                    {viewport.width}×{viewport.height}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">Scope</legend>
            <div className="flex flex-wrap gap-4">
              {SCOPES.map((option) => (
                <label key={option.value} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name={`${ids}-scope`}
                    className="size-4 accent-primary"
                    checked={scope === option.value}
                    onChange={() => setScope(option.value)}
                  />
                  {option.label}
                </label>
              ))}
            </div>
            {scope === 'custom' && (
              <div className="grid gap-2">
                <Label htmlFor={`${ids}-urls`}>URLs (one per line)</Label>
                <Textarea
                  id={`${ids}-urls`}
                  rows={4}
                  value={customUrls}
                  onChange={(e) => setCustomUrls(e.target.value)}
                  placeholder="https://www.example.com/about"
                  className="font-mono text-xs"
                />
              </div>
            )}
            {scope === 'sample' && (
              <div className="grid gap-2">
                <Label htmlFor={`${ids}-sample`}>Number of URLs</Label>
                <Input
                  id={`${ids}-sample`}
                  type="number"
                  min={1}
                  value={sample}
                  onChange={(e) => setSample(e.target.value)}
                  className="max-w-32"
                />
              </div>
            )}
          </fieldset>

          <div className="grid gap-2">
            <Label htmlFor={`${ids}-note`}>Note</Label>
            <Input
              id={`${ids}-note`}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional, e.g. before the theme update"
            />
          </div>

          <div role="status" aria-live="polite" aria-label="Estimate" className="text-sm">
            {invalid ? (
              <span className="text-muted-foreground">
                Select a snapshot, at least one viewport and the URLs to capture.
              </span>
            ) : preview.state === 'loading' || preview.state === 'idle' ? (
              <span className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Estimating…
              </span>
            ) : preview.state === 'error' ? (
              <span className="text-destructive">{preview.message}</span>
            ) : (
              <span>
                {preview.items.length} item{preview.items.length === 1 ? '' : 's'} · ≈{' '}
                {formatDuration(estimateRunMs(preview.items.length, itemMs, concurrency))}
              </span>
            )}
          </div>

          {showItems && items && (
            <div className="max-h-64 overflow-auto rounded-md border">
              <table className="w-full text-xs">
                <caption className="sr-only">Items of the dry run</caption>
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th scope="col" className="px-2 py-1 font-medium">
                      URL
                    </th>
                    <th scope="col" className="px-2 py-1 font-medium">
                      Viewport
                    </th>
                    <th scope="col" className="px-2 py-1 font-medium">
                      Filename
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.slice(0, PREVIEW_LIMIT).map((item) => (
                    <tr key={`${item.url} ${item.viewportSlug}`} className="border-t">
                      <td className="px-2 py-1 font-mono break-all">{item.url}</td>
                      <td className="px-2 py-1">{item.viewportSlug ?? 'file'}</td>
                      <td className="px-2 py-1 font-mono">{item.filename}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {items.length > PREVIEW_LIMIT && (
                <p className="px-2 py-1 text-xs text-muted-foreground">
                  and {items.length - PREVIEW_LIMIT} more
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setShowItems((v) => !v)}
            disabled={invalid || !items}
            aria-pressed={showItems}
          >
            <ListChecks aria-hidden />
            Dry run
          </Button>
          <Button onClick={start} disabled={invalid || pending || preview.state === 'error'}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Camera aria-hidden />}
            Start run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
