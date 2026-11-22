import type { ReactNode } from 'react';
import { ActiveJobs } from '@/components/app-shell/ActiveJobs';
import { AppSidebar } from '@/components/app-shell/AppSidebar';
import { Breadcrumbs } from '@/components/app-shell/Breadcrumbs';
import type { ProjectSummary } from '@/components/app-shell/types';
import { UserMenu } from '@/components/app-shell/UserMenu';
import { requireUser } from '@/lib/auth/session';
import { listProjects } from '@/lib/projects';
import { listActiveJobs } from '@/lib/runs/queries';

/** Signed-in layout (08 §2): sidebar, top bar with breadcrumbs, active jobs and user menu. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const [{ projects }, activeJobs] = await Promise.all([listProjects(), listActiveJobs()]);
  const summaries: ProjectSummary[] = projects.map((project) => ({
    id: project.id,
    slug: project.slug,
    name: project.name,
    archived: project.archivedAt !== null,
  }));

  return (
    <div className="flex h-screen">
      <AppSidebar projects={summaries} isPlatformAdmin={user.isPlatformAdmin} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b px-6">
          <Breadcrumbs projects={summaries} />
          <div className="flex items-center gap-2">
            <ActiveJobs initial={activeJobs} projects={summaries} />
            <UserMenu email={user.email} fullName={user.fullName} />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
