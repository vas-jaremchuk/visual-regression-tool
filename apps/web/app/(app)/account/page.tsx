import type { Metadata } from 'next';
import { NotificationMutes } from '@/components/account/NotificationMutes';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/session';
import { listProjectMutes } from '@/lib/notifications/queries';

export const metadata: Metadata = { title: 'Account · Visual Regression Tool' };

/** `/account` (08 §1): profile and personal notification mutes (F-NOTIFY-5). */
export default async function AccountPage() {
  const user = await requireUser();
  const projects = await listProjectMutes(user.id);
  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Account</h1>
        <p className="text-sm text-muted-foreground">
          {user.fullName ? `${user.fullName} · ` : ''}
          {user.email}
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Notification mutes</h2>
          </CardTitle>
          <CardDescription>
            Muted projects send you no notification emails. Slack channels are not affected.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NotificationMutes projects={projects} />
        </CardContent>
      </Card>
    </div>
  );
}
