import { FREE_TIER_BYTES, formatBytes } from '@vrt/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/session';
import { listAllProjectStorage } from '@/lib/storage/queries';

export const metadata: Metadata = { title: 'Storage · Admin · Visual Regression Tool' };

function formatTime(iso: string) {
  return `${new Date(iso).toISOString().replace('T', ' ').slice(0, 16)} UTC`;
}

/** Admin → Storage (F-STORAGE-4): cached usage of every project's bucket. Platform admins only. */
export default async function AdminStoragePage() {
  const user = await requireUser();
  if (!user.isPlatformAdmin) notFound();
  const projects = await listAllProjectStorage();
  const total = projects.reduce((sum, p) => sum + (p.usage?.totalBytes ?? 0), 0);
  const objects = projects.reduce((sum, p) => sum + (p.usage?.objectCount ?? 0), 0);

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Storage</h1>
        <p className="text-sm text-muted-foreground tabular-nums">
          {formatBytes(total)} in {objects} objects across {projects.length} projects (last measured
          values; refresh on each project&apos;s storage page). Free tier:{' '}
          {formatBytes(FREE_TIER_BYTES)}.
        </p>
      </div>

      {projects.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>No projects yet</h2>
            </CardTitle>
            <CardDescription>Create a project to start measuring storage.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <caption className="sr-only">Storage by project</caption>
            <thead className="bg-muted/50 text-left">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Project
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Bucket
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Size
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Objects
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Measured
                </th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="px-3 py-2">
                    <Link
                      href={`/p/${p.slug}/storage`}
                      className="underline-offset-4 hover:underline"
                    >
                      {p.name}
                    </Link>
                    {p.archived && (
                      <Badge variant="outline" className="ml-2">
                        archived
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono">{p.bucket}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {p.usage ? formatBytes(p.usage.totalBytes) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {p.usage ? p.usage.objectCount : '—'}
                  </td>
                  <td className="px-3 py-2">
                    {!p.usage ? (
                      <span className="text-muted-foreground">never</span>
                    ) : p.usage.status === 'failed' ? (
                      <Badge className="border-transparent bg-destructive text-white">failed</Badge>
                    ) : p.usage.status === 'running' ? (
                      <Badge variant="secondary">refreshing</Badge>
                    ) : p.usage.refreshedAt ? (
                      <time dateTime={p.usage.refreshedAt}>{formatTime(p.usage.refreshedAt)}</time>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
