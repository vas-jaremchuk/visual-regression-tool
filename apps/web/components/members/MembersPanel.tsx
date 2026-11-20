'use client';

import type { ProjectRole } from '@vrt/shared';
import { Loader2, UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import {
  deleteMember,
  inviteMember,
  resendMemberInvitation,
  revokeMemberInvitation,
  updateMemberRole,
} from '@/app/(app)/p/[slug]/settings/members/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { InvitationRow, MemberRow } from '@/lib/members/queries';
import { selectClassName } from './role-select-class';
import { useAction } from './use-action';

const ROLES: ProjectRole[] = ['admin', 'editor', 'viewer'];

function InviteForm({ projectId }: { projectId: string }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<ProjectRole>('viewer');
  const [pending, run] = useAction();
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        run(
          () => inviteMember({ projectId, email, role }),
          () => setEmail(''),
        );
      }}
    >
      <div className="grid min-w-64 flex-1 gap-2">
        <Label htmlFor="invite-email">Email</Label>
        <Input
          id="invite-email"
          type="email"
          required
          placeholder="name@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="invite-role">Role</Label>
        <select
          id="invite-role"
          className={selectClassName}
          value={role}
          onChange={(event) => setRole(event.target.value as ProjectRole)}
        >
          {ROLES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" disabled={pending || !email}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <UserPlus aria-hidden />}
        Invite
      </Button>
    </form>
  );
}

function MemberItem({
  projectId,
  member,
  canManage,
  isSelf,
}: {
  projectId: string;
  member: MemberRow;
  canManage: boolean;
  isSelf: boolean;
}) {
  const [pending, run] = useAction();
  const label = member.fullName ? `${member.fullName} (${member.email})` : member.email;
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{member.fullName ?? member.email}</p>
        {member.fullName && <p className="text-sm text-muted-foreground">{member.email}</p>}
      </div>
      <div className="flex items-center gap-2">
        {isSelf && <Badge variant="outline">You</Badge>}
        {member.disabled && <Badge variant="secondary">Disabled</Badge>}
        {canManage ? (
          <>
            <select
              aria-label={`Role of ${label}`}
              className={selectClassName}
              value={member.role}
              disabled={pending}
              onChange={(event) =>
                run(() =>
                  updateMemberRole({ projectId, userId: member.userId, role: event.target.value }),
                )
              }
            >
              {ROLES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              aria-label={`Remove ${label}`}
              onClick={() => {
                if (window.confirm(`Remove ${member.email} from this project?`)) {
                  run(() => deleteMember({ projectId, userId: member.userId }));
                }
              }}
            >
              Remove
            </Button>
          </>
        ) : (
          <Badge variant="secondary">{member.role}</Badge>
        )}
      </div>
    </li>
  );
}

function InvitationItem({ invitation }: { invitation: InvitationRow }) {
  const [pending, run] = useAction();
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{invitation.email}</p>
        <p className="text-sm text-muted-foreground">
          {invitation.role} ·{' '}
          {invitation.state === 'expired'
            ? 'expired'
            : `expires ${new Date(invitation.expiresAt).toLocaleDateString()}`}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {invitation.state === 'expired' && <Badge variant="secondary">Expired</Badge>}
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          aria-label={`Resend invitation to ${invitation.email}`}
          onClick={() => run(() => resendMemberInvitation(invitation.id))}
        >
          Resend
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          aria-label={`Revoke invitation to ${invitation.email}`}
          onClick={() => run(() => revokeMemberInvitation(invitation.id))}
        >
          Revoke
        </Button>
      </div>
    </li>
  );
}

export function MembersPanel({
  projectId,
  currentUserId,
  canManage,
  members,
  invitations,
}: {
  projectId: string;
  currentUserId: string;
  canManage: boolean;
  members: MemberRow[];
  invitations: InvitationRow[];
}) {
  return (
    <div className="grid gap-6">
      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Invite a member</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <InviteForm projectId={projectId} />
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Members</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {members.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-6 text-center text-sm text-muted-foreground">
              <Users className="size-8" aria-hidden />
              No members yet. Platform admins can access every project.
            </div>
          ) : (
            <ul aria-label="Members" className="divide-y">
              {members.map((member) => (
                <MemberItem
                  key={member.userId}
                  projectId={projectId}
                  member={member}
                  canManage={canManage}
                  isSelf={member.userId === currentUserId}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Pending invitations</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {invitations.length === 0 ? (
              <p className="text-sm text-muted-foreground">No pending invitations.</p>
            ) : (
              <ul aria-label="Pending invitations" className="divide-y">
                {invitations.map((invitation) => (
                  <InvitationItem key={invitation.id} invitation={invitation} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
