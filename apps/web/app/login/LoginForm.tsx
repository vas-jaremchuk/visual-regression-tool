'use client';

import { Loader2, MailCheck } from 'lucide-react';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { sendMagicLink, type MagicLinkState } from './actions';

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<MagicLinkState, FormData>(sendMagicLink, {
    status: 'idle',
  });

  if (state.status === 'sent') {
    return (
      <div role="status" className="flex items-start gap-3 rounded-md border p-4 text-sm">
        <MailCheck className="mt-0.5 size-5 text-primary" aria-hidden />
        <p>
          Check your email. If an account exists for that address, we sent a sign-in link to it.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <div className="grid gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          required
          defaultValue={state.email}
          aria-invalid={state.status === 'error' || undefined}
          aria-describedby={state.status === 'error' ? 'email-error' : undefined}
        />
        {state.status === 'error' && (
          <p id="email-error" role="alert" className="text-sm text-destructive">
            {state.message}
          </p>
        )}
      </div>
      <Button type="submit" disabled={pending}>
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        Send magic link
      </Button>
    </form>
  );
}
