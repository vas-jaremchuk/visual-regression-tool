'use client';

import type { IgnoreRuleInput, IgnoreRuleType, Region } from '@vrt/shared';
import { Loader2 } from 'lucide-react';
import { useRef, useState, type PointerEvent } from 'react';
import {
  createIgnoreRuleAction,
  updateIgnoreRuleAction,
} from '@/app/(app)/p/[slug]/ignore-rules/actions';
import { useAction } from '@/components/members/use-action';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export const RULE_TYPES: { type: IgnoreRuleType; label: string }[] = [
  { type: 'url_pattern', label: 'URL pattern' },
  { type: 'selector', label: 'Hide element (CSS selector)' },
  { type: 'region', label: 'Ignore region (pixels)' },
];

export interface RuleDraft {
  type: IgnoreRuleType;
  urlPattern: string;
  selector: string;
  region: Region | null;
  viewportSlug: string;
  appliesTo: 'capture' | 'compare' | 'both';
  enabled: boolean;
  reason: string;
}

export const EMPTY_DRAFT: RuleDraft = {
  type: 'url_pattern',
  urlPattern: '',
  selector: '',
  region: null,
  viewportSlug: '',
  appliesTo: 'both',
  enabled: true,
  reason: '',
};

function toInput(draft: RuleDraft): IgnoreRuleInput {
  return {
    type: draft.type,
    urlPattern: draft.urlPattern,
    selector: draft.selector,
    region: draft.region,
    viewportSlug: draft.viewportSlug,
    appliesTo: draft.appliesTo,
    enabled: draft.enabled,
    reason: draft.reason,
  };
}

/**
 * Create/edit dialog of an ignore rule (F-IGNORE-1), also opened prefilled by the item viewer
 * shortcuts (F-REVIEW-3). With `image`, a region rule is drawn on it in image pixel coordinates.
 */
export function IgnoreRuleDialog({
  projectId,
  open,
  onOpenChange,
  ruleId,
  initial,
  viewports,
  image,
  title,
  onSaved,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edits this rule; creates a new one when absent. */
  ruleId?: string;
  initial: RuleDraft;
  viewports: string[];
  image?: { src: string; alt: string } | null;
  title?: string;
  onSaved?: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [pending, run] = useAction();
  const set = (patch: Partial<RuleDraft>) => setDraft((d) => ({ ...d, ...patch }));

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const rule = toInput(draft);
    run(
      () =>
        ruleId
          ? updateIgnoreRuleAction({ projectId, id: ruleId, rule })
          : createIgnoreRuleAction({ projectId, rule }),
      () => {
        onOpenChange(false);
        onSaved?.();
      },
    );
  }

  const viewportOptions =
    draft.viewportSlug && !viewports.includes(draft.viewportSlug)
      ? [...viewports, draft.viewportSlug]
      : viewports;

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className={image && draft.type === 'region' ? 'sm:max-w-5xl' : undefined}>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title ?? (ruleId ? 'Edit ignore rule' : 'Add ignore rule')}</DialogTitle>
            <DialogDescription>
              New runs and comparisons use the rule; finished ones keep the rules they ran with.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-1">
            <Label htmlFor="rule-type">Type</Label>
            <select
              id="rule-type"
              className={selectClassName}
              value={draft.type}
              onChange={(e) => set({ type: e.target.value as IgnoreRuleType })}
            >
              {RULE_TYPES.map((t) => (
                <option key={t.type} value={t.type}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-1">
            <Label htmlFor="rule-url-pattern">
              URL pattern{draft.type === 'url_pattern' ? '' : ' (optional, empty = every URL)'}
            </Label>
            <Input
              id="rule-url-pattern"
              className="font-mono"
              required={draft.type === 'url_pattern'}
              placeholder="https://www.example.com/blog/**"
              value={draft.urlPattern}
              onChange={(e) => set({ urlPattern: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Matches the full URL. <code>*</code> = any characters except <code>/</code>,{' '}
              <code>**</code> = any characters, or <code>re:</code> followed by a regular
              expression.
            </p>
          </div>

          {draft.type === 'url_pattern' && (
            <div className="grid gap-1">
              <Label htmlFor="rule-applies-to">Applies to</Label>
              <select
                id="rule-applies-to"
                className={selectClassName}
                value={draft.appliesTo}
                onChange={(e) => set({ appliesTo: e.target.value as RuleDraft['appliesTo'] })}
              >
                <option value="both">Capture and compare</option>
                <option value="capture">Capture: the URL is not captured</option>
                <option value="compare">Compare: changes are ignored automatically</option>
              </select>
            </div>
          )}

          {draft.type === 'selector' && (
            <div className="grid gap-1">
              <Label htmlFor="rule-selector">CSS selector</Label>
              <Input
                id="rule-selector"
                className="font-mono"
                required
                placeholder="#live-chat, .ad-banner"
                value={draft.selector}
                onChange={(e) => set({ selector: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Matching elements get <code>visibility: hidden</code> before the screenshot.
              </p>
            </div>
          )}

          {draft.type === 'region' && (
            <RegionFields
              region={draft.region}
              onChange={(region) => set({ region })}
              image={image ?? null}
            />
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label htmlFor="rule-viewport">Viewport</Label>
              <select
                id="rule-viewport"
                className={selectClassName}
                value={draft.viewportSlug}
                onChange={(e) => set({ viewportSlug: e.target.value })}
              >
                <option value="">All viewports</option>
                {viewportOptions.map((slug) => (
                  <option key={slug} value={slug}>
                    {slug}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="rule-reason">Reason (optional)</Label>
              <Input
                id="rule-reason"
                maxLength={500}
                value={draft.reason}
                onChange={(e) => set({ reason: e.target.value })}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => set({ enabled: e.target.checked })}
            />
            Enabled
          </label>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              {ruleId ? 'Save rule' : 'Add rule'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const REGION_FIELDS = ['x', 'y', 'width', 'height'] as const;

/** Region as numbers, and, with an image, drawn by dragging on it (image pixel coordinates). */
function RegionFields({
  region,
  onChange,
  image,
}: {
  region: Region | null;
  onChange: (region: Region | null) => void;
  image: { src: string; alt: string } | null;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);

  // Converts a pointer position to image pixels, whatever the displayed (zoomed) size.
  const toPixel = (event: PointerEvent<HTMLDivElement>) => {
    const img = imgRef.current!;
    const rect = img.getBoundingClientRect();
    const sx = img.naturalWidth / rect.width;
    const sy = img.naturalHeight / rect.height;
    return {
      x: Math.round(Math.min(Math.max(event.clientX - rect.left, 0), rect.width) * sx),
      y: Math.round(Math.min(Math.max(event.clientY - rect.top, 0), rect.height) * sy),
    };
  };

  const drag = (event: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const p = toPixel(event);
    const x = Math.min(p.x, start.current.x);
    const y = Math.min(p.y, start.current.y);
    onChange({
      x,
      y,
      width: Math.max(1, Math.abs(p.x - start.current.x)),
      height: Math.max(1, Math.abs(p.y - start.current.y)),
    });
  };

  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-4 gap-2">
        {REGION_FIELDS.map((field) => (
          <div key={field} className="grid gap-1">
            <Label htmlFor={`rule-region-${field}`} className="text-xs">
              {field} (px)
            </Label>
            <Input
              id={`rule-region-${field}`}
              type="number"
              min={field === 'x' || field === 'y' ? 0 : 1}
              step={1}
              required
              value={region?.[field] ?? ''}
              onChange={(e) => {
                const value = e.target.value === '' ? 0 : Math.round(Number(e.target.value));
                onChange({ ...(region ?? { x: 0, y: 0, width: 1, height: 1 }), [field]: value });
              }}
            />
          </div>
        ))}
      </div>
      {image && (
        <>
          <p className="text-xs text-muted-foreground">
            Drag on the after screenshot to draw the region. It is masked in both images before the
            diff.
          </p>
          <div className="max-h-[55vh] overflow-auto rounded border">
            <div
              className="relative cursor-crosshair touch-none select-none"
              data-testid="region-canvas"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                start.current = toPixel(e);
              }}
              onPointerMove={drag}
              onPointerUp={(e) => {
                drag(e);
                start.current = null;
              }}
            >
              {/* Full R2 PNG, possibly signed: next/image would proxy and re-encode it. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={imgRef}
                src={image.src}
                alt={image.alt}
                draggable={false}
                className="block h-auto w-full max-w-none"
                onLoad={(e) =>
                  setNatural({
                    width: e.currentTarget.naturalWidth,
                    height: e.currentTarget.naturalHeight,
                  })
                }
              />
              {region && natural && (
                <div
                  aria-hidden
                  data-testid="region-box"
                  className="pointer-events-none absolute border-2 border-[#ff0080] bg-[#7f7f7f]/60"
                  style={{
                    left: `${(region.x / natural.width) * 100}%`,
                    top: `${(region.y / natural.height) * 100}%`,
                    width: `${(region.width / natural.width) * 100}%`,
                    height: `${(region.height / natural.height) * 100}%`,
                  }}
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
