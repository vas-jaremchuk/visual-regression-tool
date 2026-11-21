'use client';

import { Loader2, Save } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { saveProjectSettings } from '@/app/(app)/p/[slug]/settings/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  SETTINGS_GROUPS,
  validateSettingsGroup,
  type FieldErrors,
  type FieldSpec,
  type FormValues,
  type SettingsGroup,
} from '@/lib/projects/settings-groups';

export function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} className="text-sm text-destructive">
      {message}
    </p>
  );
}

function Field({
  spec,
  value,
  error,
  disabled,
  lockedHint,
  onChange,
}: {
  spec: FieldSpec;
  value: string | boolean | undefined;
  error: string | undefined;
  disabled: boolean;
  lockedHint: string | undefined;
  onChange: (value: string | boolean) => void;
}) {
  const id = `setting-${spec.name}`;
  const describedBy = [error && `${id}-error`, (spec.hint || lockedHint) && `${id}-hint`]
    .filter(Boolean)
    .join(' ');
  const common = {
    id,
    name: spec.name,
    disabled,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy || undefined,
  };
  const hint = (lockedHint || spec.hint) && (
    <p id={`${id}-hint`} className="text-sm text-muted-foreground">
      {lockedHint ?? spec.hint}
    </p>
  );

  if (spec.kind === 'boolean') {
    return (
      <div className="grid gap-1">
        <div className="flex items-center gap-2">
          <input
            {...common}
            type="checkbox"
            className="size-4 accent-primary"
            checked={value === true}
            onChange={(event) => onChange(event.target.checked)}
          />
          <Label htmlFor={id}>{spec.label}</Label>
        </div>
        {hint}
        <FieldError id={`${id}-error`} message={error} />
      </div>
    );
  }
  const text = typeof value === 'string' ? value : '';
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{spec.label}</Label>
      {spec.kind === 'textarea' || spec.kind === 'lines' ? (
        <Textarea
          {...common}
          rows={spec.kind === 'lines' ? 4 : 3}
          className={spec.kind === 'lines' || spec.name === 'extraCss' ? 'font-mono' : undefined}
          value={text}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Input
          {...common}
          type={spec.kind === 'number' ? 'number' : spec.kind === 'url' ? 'url' : 'text'}
          step={spec.kind === 'number' ? (spec.step ?? 1) : undefined}
          inputMode={spec.kind === 'number' ? 'decimal' : undefined}
          value={text}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {hint}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

/**
 * One settings tab (03 §6). Values are validated with `projectSettingsSchema` before they are
 * sent, and again on the server; errors from either show next to the field.
 */
export function SettingsForm({
  projectId,
  slug,
  group,
  initial,
  locked = {},
  disabled = false,
}: {
  projectId: string;
  slug: string;
  group: SettingsGroup;
  initial: FormValues;
  /** Field → reason it is read-only. */
  locked?: Partial<Record<string, string>>;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = useState<FormValues>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, startTransition] = useTransition();
  const fields = SETTINGS_GROUPS[group] as readonly FieldSpec[];

  function submit() {
    const validation = validateSettingsGroup(group, values);
    if (!validation.ok) {
      setErrors(validation.fieldErrors);
      return;
    }
    setErrors({});
    startTransition(async () => {
      const result = await saveProjectSettings({ projectId, group, values: values as never });
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast.error(result.message);
        return;
      }
      toast.success(result.message);
      if (result.data && result.data.slug !== slug) {
        router.replace(`/p/${result.data.slug}/settings/${group}`);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <form
      noValidate
      aria-label={`${group} settings`}
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {fields.map((spec) => (
        <Field
          key={spec.name}
          spec={spec}
          value={values[spec.name]}
          error={errors[spec.name]}
          disabled={disabled || pending || Boolean(locked[spec.name])}
          lockedHint={locked[spec.name]}
          onChange={(value) => setValues((current) => ({ ...current, [spec.name]: value }))}
        />
      ))}
      {errors.form && <FieldError id={`${group}-form-error`} message={errors.form} />}
      <div>
        <Button type="submit" disabled={disabled || pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
          Save
        </Button>
      </div>
    </form>
  );
}
