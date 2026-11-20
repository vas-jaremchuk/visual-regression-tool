import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MembersPanel } from '@/components/members/MembersPanel';
import { requireUser } from '@/lib/auth/session';
import { assertCan } from '@/lib/auth/assert-can';
import { getProjectBySlug, listProjectMembers } from '@/lib/members/queries';

export const metadata: Metadata = { title: 'Members · Visual Regression Tool' };

async function canManage(user: Awaited<ReturnType<typeof requireUser>>, projectId: string) {
  try {
    await assertCan(user, 'member.manage', projectId);
    return true;
  } catch {
    return false;
  }
}

/** Project settings → Members (03 §6, 04 §4). Everyone sees the list; admins manage it. */
export default async function MembersPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireUser();
  const project = await getProjectBySlug(slug);
  if (!project) notFound();
  const [{ members, invitations }, manage] = await Promise.all([
    listProjectMembers(project.id),
    canManage(user, project.id),
  ]);

  return (
    <div className="mx-auto grid max-w-4xl gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Members</h1>
        <p className="text-sm text-muted-foreground">
          {manage
            ? `Invite people to ${project.name} and manage their roles.`
            : `People with access to ${project.name}. Only project admins can change members.`}
        </p>
      </div>
      <MembersPanel
        projectId={project.id}
        currentUserId={user.id}
        canManage={manage}
        members={members}
        invitations={invitations}
      />
    </div>
  );
}
