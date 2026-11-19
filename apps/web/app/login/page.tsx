import type { Metadata } from 'next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { safeNext } from '@/lib/auth/safe-next';
import { serverEnv } from '@/lib/env';
import { signInWithGoogle } from './actions';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = { title: 'Sign in · Visual Regression Tool' };

const ERRORS: Record<string, string> = {
  disabled: 'Your account has been disabled. Contact a platform admin.',
  link: 'That sign-in link is invalid or has expired. Request a new one.',
  oauth: 'Google sign-in failed. Try again or use a magic link.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const target = safeNext(next);
  const errorMessage = error ? (ERRORS[error] ?? ERRORS.link) : undefined;

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>
            <h1 className="text-xl">Sign in</h1>
          </CardTitle>
          <CardDescription>Visual Regression Tool is invite-only.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          {errorMessage && (
            <p
              role="alert"
              className="rounded-md border border-destructive/50 p-3 text-sm text-destructive"
            >
              {errorMessage}
            </p>
          )}
          <LoginForm next={target} />
          {serverEnv().GOOGLE_AUTH_ENABLED && (
            <form action={signInWithGoogle}>
              <input type="hidden" name="next" value={target} />
              <Button type="submit" variant="outline" className="w-full">
                Continue with Google
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
