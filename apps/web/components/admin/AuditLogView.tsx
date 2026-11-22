import Link from 'next/link';
import { selectClassName } from '@/components/members/role-select-class';
import { formatTime } from '@/components/runs/format';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { auditPageHref, type AuditFilters } from '@/lib/admin/audit-filters';
import type { ActorOption, AuditEntry } from '@/lib/admin/queries';

interface ProjectOption {
  id: string;
  name: string;
}

/**
 * Audit log filters, table and paging (F-ADMIN-2). A plain GET form, so filtered views are links.
 * `projects` is omitted on the project-level tab, where the project is fixed.
 */
export function AuditLogView({
  path,
  filters,
  entries,
  hasMore,
  actors,
  projects,
}: {
  path: string;
  filters: AuditFilters;
  entries: AuditEntry[];
  hasMore: boolean;
  actors: ActorOption[];
  projects?: ProjectOption[];
}) {
  const projectNames = new Map(projects?.map((p) => [p.id, p.name]));
  // On the project tab the project is part of the path, not a filter the user chose.
  const chosen = projects ? filters : { ...filters, project: undefined };
  const filtered = Boolean(
    chosen.project || chosen.actor || chosen.action || chosen.from || chosen.to,
  );
  return (
    <div className="grid gap-4">
      <form
        method="get"
        action={path}
        aria-label="Audit log filters"
        className="flex flex-wrap items-end gap-3"
      >
        {projects && (
          <div className="grid gap-1">
            <Label htmlFor="audit-project">Project</Label>
            <select
              id="audit-project"
              name="project"
              defaultValue={filters.project ?? ''}
              className={selectClassName}
            >
              <option value="">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="grid gap-1">
          <Label htmlFor="audit-actor">Actor</Label>
          <select
            id="audit-actor"
            name="actor"
            defaultValue={filters.actor ?? ''}
            className={selectClassName}
          >
            <option value="">Everyone</option>
            {actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="audit-action">Action</Label>
          <Input
            id="audit-action"
            name="action"
            placeholder="e.g. run."
            defaultValue={filters.action ?? ''}
            className="w-40"
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="audit-from">From</Label>
          <Input id="audit-from" name="from" type="date" defaultValue={filters.from ?? ''} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="audit-to">To</Label>
          <Input id="audit-to" name="to" type="date" defaultValue={filters.to ?? ''} />
        </div>
        <Button type="submit">Filter</Button>
        {filtered && (
          <Button asChild variant="ghost">
            <Link href={path}>Clear</Link>
          </Button>
        )}
      </form>

      {entries.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>No audit entries</h2>
            </CardTitle>
            <CardDescription>
              {filtered
                ? 'Nothing matches these filters.'
                : 'Changes people make are recorded here.'}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <caption className="sr-only">Audit log entries, newest first</caption>
            <thead className="bg-muted/50 text-left">
              <tr>
                {['Time', 'Actor', ...(projects ? ['Project'] : []), 'Action', 'Details'].map(
                  (h) => (
                    <th key={h} scope="col" className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-t align-top">
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                    {formatTime(entry.createdAt)}
                  </td>
                  <td className="px-3 py-2">{entry.actor ?? '—'}</td>
                  {projects && (
                    <td className="px-3 py-2">
                      {entry.projectId ? (projectNames.get(entry.projectId) ?? '—') : 'Platform'}
                    </td>
                  )}
                  <td className="px-3 py-2 font-mono">{entry.action}</td>
                  <td className="px-3 py-2">
                    <code className="block max-w-xl text-xs break-all text-muted-foreground">
                      {JSON.stringify(entry.details)}
                    </code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(filters.page > 1 || hasMore) && (
        <nav aria-label="Audit log pages" className="flex items-center justify-between gap-2">
          {filters.page > 1 ? (
            <Button asChild variant="outline">
              <Link href={auditPageHref(path, chosen, filters.page - 1)}>Newer</Link>
            </Button>
          ) : (
            <span />
          )}
          <span className="text-sm text-muted-foreground">Page {filters.page}</span>
          {hasMore ? (
            <Button asChild variant="outline">
              <Link href={auditPageHref(path, chosen, filters.page + 1)}>Older</Link>
            </Button>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
