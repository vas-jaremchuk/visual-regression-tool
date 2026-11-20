import { Camera, GitCompare, ListTree, Settings } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/session';
import { canDo } from '@/lib/projects/access';
import { getProjectDetail, recentActivity } from '@/lib/projects/queries';

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const project = await getProjectDetail(slug);
  return { title: `${project?.settings.name ?? 'Project'} · Visual Regression Tool` };
}

function EmptyCard({ title, text }: { title: string; text: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{title}</h2>
        </CardTitle>
        <CardDescription>{text}</CardDescription>
      </CardHeader>
    </Card>
  );
}

/**
 * Project overview (08 §3). Skeleton: baseline, run and comparison cards are filled in by the
 * sitemap, run and comparison tickets; quick actions are enabled there too.
 */
export default async function ProjectOverviewPage({ params }: { params: Params }) {
  const { slug } = await params;
  const user = await requireUser();
  const project = await getProjectDetail(slug);
  if (!project) notFound();
  const [activity, admin] = await Promise.all([
    recentActivity(project.id),
    canDo(user, 'project.settings', project.id),
  ]);

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            {project.settings.name}
            {project.archivedAt && <Badge variant="secondary">Archived</Badge>}
          </h1>
          <p className="text-sm break-all text-muted-foreground">{project.settings.sitemapIndex}</p>
        </div>
        {admin && (
          <Button asChild variant="outline">
            <Link href={`/p/${slug}/settings/general`}>
              <Settings aria-hidden />
              Settings
            </Link>
          </Button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <EmptyCard title="Baseline" text="No baseline yet. Promote a completed run to set one." />
        <EmptyCard title="Last run" text="No runs yet. Fetch the sitemap first." />
        <EmptyCard title="Last comparison" text="No comparisons yet." />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Quick actions</h2>
          </CardTitle>
          <CardDescription>Available once sitemaps and runs are supported.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" disabled>
            <ListTree aria-hidden />
            Fetch sitemap
          </Button>
          <Button variant="outline" disabled>
            <Camera aria-hidden />
            New run
          </Button>
          <Button variant="outline" disabled>
            <GitCompare aria-hidden />
            Compare latest with baseline
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Recent activity</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activity.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {admin ? 'No activity yet.' : 'Activity is visible to project admins.'}
            </p>
          ) : (
            <ul aria-label="Recent activity" className="grid gap-2 text-sm">
              {activity.map((entry) => (
                <li key={entry.id} className="flex flex-wrap justify-between gap-2">
                  <span>
                    <span className="font-mono">{entry.action}</span>
                    {entry.actor && (
                      <span className="text-muted-foreground"> by {entry.actor}</span>
                    )}
                  </span>
                  <time dateTime={entry.createdAt} className="text-muted-foreground">
                    {new Date(entry.createdAt).toISOString().replace('T', ' ').slice(0, 16)} UTC
                  </time>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
