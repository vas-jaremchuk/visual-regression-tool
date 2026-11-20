import type { ReactNode } from 'react';
import { SettingsTabs } from '@/components/projects/SettingsTabs';
import { requireUser } from '@/lib/auth/session';
import { canDo } from '@/lib/projects/access';
import { getProjectDetail } from '@/lib/projects/queries';

/** Settings shell (08 §1): the tab bar is shown to project admins, who can open every tab. */
export default async function SettingsLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await requireUser();
  const project = await getProjectDetail(slug);
  const admin = project ? await canDo(user, 'project.settings', project.id) : false;
  return (
    <div className="mx-auto grid max-w-4xl gap-6">
      {admin && <SettingsTabs slug={slug} />}
      {children}
    </div>
  );
}
