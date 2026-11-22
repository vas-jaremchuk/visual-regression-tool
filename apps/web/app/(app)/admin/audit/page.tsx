import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AuditLogView } from '@/components/admin/AuditLogView';
import { parseAuditFilters } from '@/lib/admin/audit-filters';
import { listActorOptions, listAuditLog } from '@/lib/admin/queries';
import { requireUser } from '@/lib/auth/session';
import { listProjects } from '@/lib/projects';

export const metadata: Metadata = { title: 'Audit log · Visual Regression Tool' };

/** Admin → Audit log (F-ADMIN-2, NFR-18). Platform admins only. */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  if (!user.isPlatformAdmin) notFound();
  const filters = parseAuditFilters(await searchParams);
  const [{ entries, hasMore }, actors, { projects }] = await Promise.all([
    listAuditLog(filters),
    listActorOptions(),
    listProjects(),
  ]);
  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Audit log</h1>
        <p className="text-sm text-muted-foreground">
          Every change made in any project or to the platform, newest first.
        </p>
      </div>
      <AuditLogView
        path="/admin/audit"
        filters={filters}
        entries={entries}
        hasMore={hasMore}
        actors={actors}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
      />
    </div>
  );
}
