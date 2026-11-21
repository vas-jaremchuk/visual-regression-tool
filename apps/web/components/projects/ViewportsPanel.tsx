'use client';

import { VIEWPORT_PRESETS } from '@vrt/shared';
import { ArrowDown, ArrowUp, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  addViewport,
  editViewport,
  removeViewport,
  reorderViewport,
} from '@/app/(app)/p/[slug]/settings/actions';
import { selectClassName } from '@/components/members/role-select-class';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ViewportRow } from '@/lib/projects/queries';
import type { FieldErrors } from '@/lib/projects/settings-groups';
import { FieldError } from './SettingsForm';

interface Draft {
  slug: string;
  width: string;
  height: string;
  deviceScaleFactor: string;
  isMobile: boolean;
  enabled: boolean;
}

type ActionOutcome = { ok: boolean; message: string; fieldErrors?: FieldErrors };

const EMPTY: Draft = {
  slug: '',
  width: '',
  height: '',
  deviceScaleFactor: '1',
  isMobile: false,
  enabled: true,
};

function toDraft(viewport: Omit<ViewportRow, 'id' | 'sortOrder' | 'used'>): Draft {
  return {
    slug: viewport.slug,
    width: String(viewport.width),
    height: String(viewport.height),
    deviceScaleFactor: String(viewport.deviceScaleFactor),
    isMobile: viewport.isMobile,
    enabled: viewport.enabled,
  };
}

function toInput(draft: Draft) {
  const number = (text: string) => (text.trim() === '' ? Number.NaN : Number(text));
  return {
    slug: draft.slug.trim(),
    width: number(draft.width),
    height: number(draft.height),
    deviceScaleFactor: number(draft.deviceScaleFactor),
    isMobile: draft.isMobile,
    enabled: draft.enabled,
  };
}

function useRunner() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (action: () => Promise<ActionOutcome>, onDone?: (r: ActionOutcome) => void) =>
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.message);
      }
      onDone?.(result);
    });
  return [pending, run] as const;
}

function ViewportForm({
  idPrefix,
  initial,
  slugLocked,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
  errors,
}: {
  idPrefix: string;
  initial: Draft;
  slugLocked: boolean;
  submitLabel: string;
  pending: boolean;
  onSubmit: (draft: Draft) => void;
  onCancel?: () => void;
  errors: FieldErrors;
}) {
  const [draft, setDraft] = useState(initial);
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const field = (name: keyof Draft, label: string, type: 'text' | 'number', step?: number) => (
    <div className="grid gap-2">
      <Label htmlFor={`${idPrefix}-${name}`}>{label}</Label>
      <Input
        id={`${idPrefix}-${name}`}
        type={type}
        step={step}
        className="w-32"
        value={String(draft[name])}
        disabled={pending || (name === 'slug' && slugLocked)}
        aria-invalid={errors[name] ? true : undefined}
        aria-describedby={errors[name] ? `${idPrefix}-${name}-error` : undefined}
        onChange={(event) => set({ [name]: event.target.value })}
      />
      <FieldError id={`${idPrefix}-${name}-error`} message={errors[name]} />
    </div>
  );

  return (
    <form
      noValidate
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(draft);
      }}
    >
      <div className="flex flex-wrap items-start gap-3">
        {field('slug', 'Slug', 'text')}
        {field('width', 'Width', 'number')}
        {field('height', 'Height', 'number')}
        {field('deviceScaleFactor', 'Scale factor', 'number', 0.25)}
      </div>
      {slugLocked && (
        <p className="text-sm text-muted-foreground">
          The slug was used in a run and cannot change.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={draft.isMobile}
            disabled={pending}
            onChange={(event) => set({ isMobile: event.target.checked })}
          />
          Mobile
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={draft.enabled}
            disabled={pending}
            onChange={(event) => set({ enabled: event.target.checked })}
          />
          Enabled
        </label>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

function AddViewport({
  projectId,
  existing,
  disabled,
}: {
  projectId: string;
  existing: string[];
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [initial, setInitial] = useState<Draft>(EMPTY);
  const [formKey, setFormKey] = useState(0);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, run] = useRunner();
  const presets = VIEWPORT_PRESETS.filter((preset) => !existing.includes(preset.slug));

  if (!open) {
    return (
      <div className="flex flex-wrap items-end gap-3">
        <Button type="button" disabled={disabled} onClick={() => setOpen(true)}>
          <Plus aria-hidden />
          Add viewport
        </Button>
      </div>
    );
  }
  return (
    <div className="grid gap-3 rounded-md border p-4">
      <div className="grid w-fit gap-2">
        <Label htmlFor="viewport-preset">Preset</Label>
        <select
          id="viewport-preset"
          className={selectClassName}
          defaultValue=""
          onChange={(event) => {
            const preset = VIEWPORT_PRESETS.find((p) => p.slug === event.target.value);
            setInitial(preset ? toDraft({ ...preset, enabled: true }) : EMPTY);
            setFormKey((key) => key + 1);
          }}
        >
          <option value="">Custom</option>
          {presets.map((preset) => (
            <option key={preset.slug} value={preset.slug}>
              {preset.slug} ({preset.width}×{preset.height})
            </option>
          ))}
        </select>
      </div>
      <ViewportForm
        key={formKey}
        idPrefix="new-viewport"
        initial={initial}
        slugLocked={false}
        submitLabel="Add"
        pending={pending}
        errors={errors}
        onCancel={() => setOpen(false)}
        onSubmit={(draft) =>
          run(
            () => addViewport({ projectId, viewport: toInput(draft) }),
            (result) => {
              setErrors(result.fieldErrors ?? {});
              if (result.ok) {
                setOpen(false);
                setInitial(EMPTY);
              }
            },
          )
        }
      />
    </div>
  );
}

function ViewportItem({
  projectId,
  viewport,
  first,
  last,
  only,
  disabled,
}: {
  projectId: string;
  viewport: ViewportRow;
  first: boolean;
  last: boolean;
  only: boolean;
  disabled: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, run] = useRunner();
  const busy = disabled || pending;

  return (
    <li className="grid gap-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{viewport.slug}</span>
          <span className="text-sm text-muted-foreground">
            {viewport.width}×{viewport.height} @{viewport.deviceScaleFactor}x
          </span>
          {viewport.isMobile && <Badge variant="secondary">Mobile</Badge>}
          {!viewport.enabled && <Badge variant="outline">Disabled</Badge>}
          {viewport.used && <Badge variant="outline">Used in runs</Badge>}
        </div>
        <div className="flex gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={`Move ${viewport.slug} up`}
            disabled={busy || first}
            onClick={() =>
              run(() => reorderViewport({ projectId, viewportId: viewport.id, direction: 'up' }))
            }
          >
            <ArrowUp aria-hidden />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={`Move ${viewport.slug} down`}
            disabled={busy || last}
            onClick={() =>
              run(() => reorderViewport({ projectId, viewportId: viewport.id, direction: 'down' }))
            }
          >
            <ArrowDown aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              run(() =>
                editViewport({
                  projectId,
                  viewportId: viewport.id,
                  viewport: toInput({ ...toDraft(viewport), enabled: !viewport.enabled }),
                }),
              )
            }
          >
            {viewport.enabled ? 'Disable' : 'Enable'}
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={`Edit ${viewport.slug}`}
            disabled={busy}
            onClick={() => setEditing((value) => !value)}
          >
            <Pencil aria-hidden />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={`Delete ${viewport.slug}`}
            title={
              viewport.used
                ? 'Used in a run: disable it instead'
                : only
                  ? 'A project needs at least one viewport'
                  : undefined
            }
            disabled={busy || viewport.used || only}
            onClick={() => run(() => removeViewport({ projectId, viewportId: viewport.id }))}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      </div>
      {editing && (
        <ViewportForm
          idPrefix={`viewport-${viewport.slug}`}
          initial={toDraft(viewport)}
          slugLocked={viewport.used}
          submitLabel="Save viewport"
          pending={pending}
          errors={errors}
          onCancel={() => setEditing(false)}
          onSubmit={(draft) =>
            run(
              () => editViewport({ projectId, viewportId: viewport.id, viewport: toInput(draft) }),
              (result) => {
                setErrors(result.fieldErrors ?? {});
                if (result.ok) setEditing(false);
              },
            )
          }
        />
      )}
    </li>
  );
}

/** Viewports tab (03 §6, F-VIEWPORT-1): add from presets, edit, disable, reorder, delete. */
export function ViewportsPanel({
  projectId,
  viewports,
  disabled,
}: {
  projectId: string;
  viewports: ViewportRow[];
  disabled: boolean;
}) {
  return (
    <div className="grid gap-4">
      {viewports.length === 0 ? (
        <p className="text-sm text-muted-foreground">No viewports yet. Add one to capture pages.</p>
      ) : (
        <ul aria-label="Viewports" className="divide-y">
          {viewports.map((viewport, index) => (
            <ViewportItem
              key={viewport.id}
              projectId={projectId}
              viewport={viewport}
              first={index === 0}
              last={index === viewports.length - 1}
              only={viewports.length === 1}
              disabled={disabled}
            />
          ))}
        </ul>
      )}
      <AddViewport
        projectId={projectId}
        existing={viewports.map((viewport) => viewport.slug)}
        disabled={disabled}
      />
    </div>
  );
}
