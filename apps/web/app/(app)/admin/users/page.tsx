import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { UsersPanel } from '@/components/members/UsersPanel';
import { requireUser } from '@/lib/auth/session';
import { listUsers } from '@/lib/members/users';

export const metadata: Metadata = { title: 'Users · Visual Regression Tool' };

/** Admin → Users (F-ADMIN-1). Platform admins only. */
export default async function UsersPage() {
  const user = await requireUser();
  if (!user.isPlatformAdmin) notFound();
  const { users, invitations } = await listUsers();
  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Users</h1>
        <p className="text-sm text-muted-foreground">
          Invite people, disable accounts and manage platform admins.
        </p>
      </div>
      <UsersPanel currentUserId={user.id} users={users} invitations={invitations} />
    </div>
  );
}
