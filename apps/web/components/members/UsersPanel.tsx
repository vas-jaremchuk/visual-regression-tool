'use client';

import { Loader2, UserPlus } from 'lucide-react';
import { useState } from 'react';
import {
  invitePlatformUser,
  resendPlatformInvitation,
  revokePlatformInvitation,
  setAdmin,
  setDisabled,
} from '@/app/(app)/admin/users/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { PlatformInvitationRow, UserRow } from '@/lib/members/users';
import { useAction } from './use-action';

function InviteUserForm() {
  const [email, setEmail] = useState('');
  const [pending, run] = useAction();
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        run(
          () => invitePlatformUser(email),
          () => setEmail(''),
        );
      }}
    >
      <div className="grid min-w-64 flex-1 gap-2">
        <Label htmlFor="invite-user-email">Email</Label>
        <Input
          id="invite-user-email"
          type="email"
          required
          placeholder="name@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <Button type="submit" disabled={pending || !email}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <UserPlus aria-hidden />}
        Invite
      </Button>
    </form>
  );
}

function UserItem({ user, isSelf }: { user: UserRow; isSelf: boolean }) {
  const [pending, run] = useAction();
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="grid min-w-0 gap-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <span className="truncate">{user.email}</span>
          {user.fullName && <span className="text-muted-foreground">{user.fullName}</span>}
          {isSelf && <Badge variant="outline">You</Badge>}
          {user.isPlatformAdmin && <Badge>Platform admin</Badge>}
          {user.disabled && <Badge variant="secondary">Disabled</Badge>}
        </p>
        <p className="text-sm text-muted-foreground">
          {user.memberships.length === 0
            ? 'No project memberships'
            : user.memberships.map((m) => `${m.projectName} (${m.role})`).join(', ')}
        </p>
      </div>
      {!isSelf && (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            aria-label={`${user.isPlatformAdmin ? 'Demote' : 'Promote'} ${user.email}`}
            onClick={() => run(() => setAdmin(user.id, !user.isPlatformAdmin))}
          >
            {user.isPlatformAdmin ? 'Remove admin' : 'Make admin'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            aria-label={`${user.disabled ? 'Enable' : 'Disable'} ${user.email}`}
            onClick={() => run(() => setDisabled(user.id, !user.disabled))}
          >
            {user.disabled ? 'Enable' : 'Disable'}
          </Button>
        </div>
      )}
    </li>
  );
}

function InvitationItem({ invitation }: { invitation: PlatformInvitationRow }) {
  const [pending, run] = useAction();
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{invitation.email}</p>
        <p className="text-sm text-muted-foreground">
          {invitation.state === 'expired'
            ? 'expired'
            : `expires ${new Date(invitation.expiresAt).toLocaleDateString()}`}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          aria-label={`Resend invitation to ${invitation.email}`}
          onClick={() => run(() => resendPlatformInvitation(invitation.id))}
        >
          Resend
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          aria-label={`Revoke invitation to ${invitation.email}`}
          onClick={() => run(() => revokePlatformInvitation(invitation.id))}
        >
          Revoke
        </Button>
      </div>
    </li>
  );
}

export function UsersPanel({
  currentUserId,
  users,
  invitations,
}: {
  currentUserId: string;
  users: UserRow[];
  invitations: PlatformInvitationRow[];
}) {
  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Invite a user</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <InviteUserForm />
          {invitations.length > 0 && (
            <ul aria-label="Pending invitations" className="divide-y">
              {invitations.map((invitation) => (
                <InvitationItem key={invitation.id} invitation={invitation} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Users</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {users.length === 0 ? (
            <p className="text-sm text-muted-foreground">No users yet.</p>
          ) : (
            <ul aria-label="Users" className="divide-y">
              {users.map((user) => (
                <UserItem key={user.id} user={user} isSelf={user.id === currentUserId} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
