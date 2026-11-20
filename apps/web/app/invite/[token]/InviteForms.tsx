'use client';

import { Loader2, MailCheck } from 'lucide-react';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { acceptInvitationAction, sendInviteSignInLink, type InviteActionState } from './actions';

function ErrorMessage({ state }: { state: InviteActionState }) {
  if (state.status !== 'error') return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {state.message}
    </p>
  );
}

export function SignInLinkForm({ token, email }: { token: string; email: string }) {
  const [state, action, pending] = useActionState(sendInviteSignInLink, { status: 'idle' });
  if (state.status === 'sent') {
    return (
      <div role="status" className="flex items-start gap-3 rounded-md border p-4 text-sm">
        <MailCheck className="mt-0.5 size-5 text-primary" aria-hidden />
        <p>Check your email. We sent a sign-in link to {email}.</p>
      </div>
    );
  }
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="token" value={token} />
      <p className="text-sm text-muted-foreground">
        Sign in as {email} to accept. We will email you a sign-in link.
      </p>
      <ErrorMessage state={state} />
      <Button type="submit" disabled={pending}>
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        Send sign-in link
      </Button>
    </form>
  );
}

export function AcceptForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(acceptInvitationAction, { status: 'idle' });
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="token" value={token} />
      <ErrorMessage state={state} />
      <Button type="submit" disabled={pending}>
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        Accept invitation
      </Button>
    </form>
  );
}
