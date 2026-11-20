'use client';

import { KeyRound, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { saveBasicAuthPassword } from '@/app/(app)/p/[slug]/settings/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FieldError } from './SettingsForm';

/**
 * Basic auth password (03 §5): write-only. The page only knows whether one is set and offers
 * *Set* / *Replace* / *Clear*; the value is encrypted on the server.
 */
export function AccessPassword({
  projectId,
  hasPassword,
  disabled,
}: {
  projectId: string;
  hasPassword: boolean;
  disabled: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();

  function save(value: string | null) {
    if (value !== null && value.length === 0) {
      setError('Enter a password');
      return;
    }
    setError(undefined);
    startTransition(async () => {
      const result = await saveBasicAuthPassword({ projectId, password: value });
      if (!result.ok) {
        setError(result.fieldErrors?.basicAuthPass);
        toast.error(result.message);
        return;
      }
      toast.success(result.message);
      setEditing(false);
      setPassword('');
      router.refresh();
    });
  }

  return (
    <section aria-labelledby="basic-auth-password" className="grid gap-3">
      <div className="flex items-center gap-2">
        <h2 id="basic-auth-password" className="text-sm font-medium">
          Basic auth password
        </h2>
        <Badge variant={hasPassword ? 'default' : 'secondary'}>
          {hasPassword ? '••••• (set)' : 'Not set'}
        </Badge>
      </div>
      {editing ? (
        <form
          noValidate
          className="flex flex-wrap items-start gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            save(password);
          }}
        >
          <div className="grid min-w-64 flex-1 gap-2">
            <Label htmlFor="basic-auth-pass" className="sr-only">
              New password
            </Label>
            <Input
              id="basic-auth-pass"
              type="password"
              autoComplete="new-password"
              placeholder="New password"
              value={password}
              disabled={pending}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'basic-auth-pass-error' : undefined}
              onChange={(event) => setPassword(event.target.value)}
            />
            <FieldError id="basic-auth-pass-error" message={error} />
          </div>
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            Save password
          </Button>
          <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={disabled || pending}
            onClick={() => setEditing(true)}
          >
            <KeyRound aria-hidden />
            {hasPassword ? 'Replace' : 'Set password'}
          </Button>
          {hasPassword && (
            <Button
              type="button"
              variant="outline"
              disabled={disabled || pending}
              onClick={() => save(null)}
            >
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              Clear
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
