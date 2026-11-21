'use client';

import { createProjectRequest, slugify, type ImportEnvResponse } from '@vrt/shared';
import { FileUp, Loader2, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { createProjectAction, previewEnvImport } from '@/app/(app)/projects/new/actions';
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
import { fieldErrorsOf, type FieldErrors } from '@/lib/projects/settings-groups';
import { FieldError } from './SettingsForm';

const FIELDS = [
  { name: 'name', label: 'Name', type: 'text' },
  { name: 'slug', label: 'Slug', type: 'text', hint: 'Generated from the name when empty.' },
  { name: 'sitemapIndex', label: 'Sitemap index URL', type: 'url' },
  { name: 'r2Bucket', label: 'R2 bucket', type: 'text' },
  { name: 'r2PublicUrl', label: 'R2 public URL (optional)', type: 'url' },
  { name: 'basicAuthUser', label: 'Basic auth user (optional)', type: 'text' },
  { name: 'basicAuthPass', label: 'Basic auth password (optional)', type: 'password' },
] as const;

type FieldName = (typeof FIELDS)[number]['name'];
type Values = Record<FieldName, string>;

const EMPTY: Values = {
  name: '',
  slug: '',
  sitemapIndex: '',
  r2Bucket: '',
  r2PublicUrl: '',
  basicAuthUser: '',
  basicAuthPass: '',
};

const OPTIONAL: ReadonlySet<FieldName> = new Set([
  'slug',
  'r2PublicUrl',
  'basicAuthUser',
  'basicAuthPass',
]);

function toRequest(values: Values) {
  const request: Record<string, string | null | undefined> = {};
  for (const { name } of FIELDS) {
    const value = values[name].trim();
    if (name === 'slug' || name === 'basicAuthPass') request[name] = value || undefined;
    else request[name] = value === '' && OPTIONAL.has(name) ? null : value;
  }
  return request;
}

const PREVIEW_LABELS: Record<string, string> = Object.fromEntries(
  FIELDS.map(({ name, label }) => [name, label.replace(/ \(optional\)$/, '')]),
);

/** F-PROJ-4: paste a prototype `.env`, preview the parsed values, then fill the form. */
function ImportEnvDialog({ onUse }: { onUse: (preview: ImportEnvResponse['preview']) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [result, setResult] = useState<ImportEnvResponse | null>(null);
  const [pending, startTransition] = useTransition();

  function parse() {
    startTransition(async () => {
      const response = await previewEnvImport(text);
      if (!response.ok || !response.data) {
        toast.error(response.message);
        return;
      }
      setResult(response.data);
    });
  }

  const entries = result ? Object.entries(result.preview) : [];
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setResult(null);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          <FileUp aria-hidden />
          Import from .env
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import from .env</DialogTitle>
          <DialogDescription>
            Paste the prototype&apos;s <code>.env</code>. Cloudflare credentials and unknown keys
            are ignored. Nothing is saved until you create the project.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="env-text">.env contents</Label>
          <Textarea
            id="env-text"
            rows={8}
            className="font-mono"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setResult(null);
            }}
          />
        </div>
        {result && (
          <div className="grid gap-3" aria-live="polite">
            <h3 className="text-sm font-medium">Preview</h3>
            {entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No project settings found.</p>
            ) : (
              <table aria-label="Imported values" className="text-sm">
                <tbody>
                  {entries.map(([key, value]) => (
                    <tr key={key} className="border-b last:border-0">
                      <th scope="row" className="py-1 pr-4 text-left font-medium">
                        {PREVIEW_LABELS[key] ?? key}
                      </th>
                      <td className="py-1 font-mono break-all">
                        {key === 'basicAuthPass' ? '••••• (set)' : String(value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {result.ignoredKeys.length > 0 && (
              <p className="text-sm text-muted-foreground">
                Ignored: {result.ignoredKeys.join(', ')}
              </p>
            )}
            {result.notes.length > 0 && (
              <ul className="list-disc pl-5 text-sm text-muted-foreground">
                {result.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        <DialogFooter>
          {result ? (
            <Button
              type="button"
              disabled={entries.length === 0}
              onClick={() => {
                onUse(result.preview);
                setOpen(false);
                setResult(null);
              }}
            >
              Use these values
            </Button>
          ) : (
            <Button type="button" disabled={pending || text.trim() === ''} onClick={parse}>
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              Preview
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** F-PROJ-1: create a project (platform admin). The default viewport is added on the server. */
export function CreateProjectForm() {
  const router = useRouter();
  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, startTransition] = useTransition();

  function submit() {
    const request = toRequest(values);
    const validation = createProjectRequest.safeParse(request);
    if (!validation.success) {
      setErrors(fieldErrorsOf(validation.error));
      return;
    }
    setErrors({});
    startTransition(async () => {
      const result = await createProjectAction(request);
      if (!result.ok || !result.data) {
        setErrors(result.ok ? {} : (result.fieldErrors ?? {}));
        toast.error(result.message);
        return;
      }
      toast.success(result.message);
      router.push(`/p/${result.data.slug}`);
    });
  }

  return (
    <div className="grid gap-6">
      <div>
        <ImportEnvDialog
          onUse={(preview) => {
            setValues({
              ...EMPTY,
              ...Object.fromEntries(
                Object.entries(preview).map(([key, value]) => [key, String(value ?? '')]),
              ),
            });
            setErrors({});
          }}
        />
      </div>
      <form
        noValidate
        aria-label="New project"
        className="grid gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {FIELDS.map((field) => {
          const id = `project-${field.name}`;
          const error = errors[field.name];
          const hint =
            'hint' in field
              ? `${field.hint}${values.name && !values.slug ? ` Will be ${slugify(values.name) || 'project'} (or the next free variant).` : ''}`
              : undefined;
          return (
            <div key={field.name} className="grid gap-2">
              <Label htmlFor={id}>{field.label}</Label>
              <Input
                id={id}
                type={field.type}
                autoComplete={field.type === 'password' ? 'new-password' : 'off'}
                value={values[field.name]}
                disabled={pending}
                aria-invalid={error ? true : undefined}
                aria-describedby={
                  [error && `${id}-error`, hint && `${id}-hint`].filter(Boolean).join(' ') ||
                  undefined
                }
                onChange={(event) =>
                  setValues((current) => ({ ...current, [field.name]: event.target.value }))
                }
              />
              {hint && (
                <p id={`${id}-hint`} className="text-sm text-muted-foreground">
                  {hint}
                </p>
              )}
              <FieldError id={`${id}-error`} message={error} />
            </div>
          );
        })}
        <p className="text-sm text-muted-foreground">
          The project starts with a desktop viewport (1280×900); you become its project admin.
        </p>
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
            Create project
          </Button>
        </div>
      </form>
    </div>
  );
}
