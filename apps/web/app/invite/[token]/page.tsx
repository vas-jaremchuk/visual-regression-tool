import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getCurrentUser } from '@/lib/auth/session';
import { findInvitation } from '@/lib/invitations/lookup';
import { signOutFromInvite } from './actions';
import { AcceptForm, SignInLinkForm } from './InviteForms';

export const metadata: Metadata = { title: 'Invitation · Visual Regression Tool' };

function Problem({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div role="alert" className="grid gap-2 rounded-md border border-destructive/50 p-4 text-sm">
      <p className="font-medium text-destructive">{title}</p>
      <p className="text-muted-foreground">{children}</p>
    </div>
  );
}

/** Accept an invitation (04 §4): link → sign-in → membership created. */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [invitation, user] = await Promise.all([findInvitation(token), getCurrentUser()]);

  let body: React.ReactNode;
  if (!invitation) {
    body = (
      <Problem title="This invitation link is invalid or has been revoked.">
        Ask the person who invited you to send a new invitation.
      </Problem>
    );
  } else if (invitation.state === 'expired') {
    body = (
      <Problem title="This invitation has expired.">
        Invitations are valid for 7 days. Ask the person who invited you to resend it.
      </Problem>
    );
  } else if (invitation.state === 'accepted') {
    body = (
      <div className="grid gap-4 text-sm">
        <p>This invitation has already been accepted.</p>
        <Button asChild>
          <Link href={user ? '/' : '/login'}>{user ? 'Go to projects' : 'Sign in'}</Link>
        </Button>
      </div>
    );
  } else if (!user) {
    body = <SignInLinkForm token={token} email={invitation.email} />;
  } else if (user.email.toLowerCase() !== invitation.email) {
    body = (
      <div className="grid gap-4">
        <Problem title="This invitation is for a different account.">
          It was sent to {invitation.email}, but you are signed in as {user.email}.
        </Problem>
        <form action={signOutFromInvite}>
          <input type="hidden" name="token" value={token} />
          <Button type="submit" variant="outline" className="w-full">
            Sign out and continue as {invitation.email}
          </Button>
        </form>
      </div>
    );
  } else {
    body = <AcceptForm token={token} />;
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            <h1 className="text-xl">You&apos;re invited</h1>
          </CardTitle>
          {invitation && (
            <CardDescription>
              {invitation.inviter ?? 'A platform admin'} invited {invitation.email} to{' '}
              {invitation.projectName
                ? `${invitation.projectName} as ${invitation.role}`
                : 'the Visual Regression Tool'}
              .
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="grid gap-6">{body}</CardContent>
      </Card>
    </main>
  );
}
