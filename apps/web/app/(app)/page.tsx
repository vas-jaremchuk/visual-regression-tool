import { FolderOpen } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getCurrentUser } from '@/lib/auth/session';
import { listProjects } from '@/lib/projects';

export default async function ProjectsPage() {
  const [user, { projects }] = await Promise.all([getCurrentUser(), listProjects()]);

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <h1 className="text-2xl font-semibold">Projects</h1>
      {projects.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-12 text-center">
          <FolderOpen className="size-10 text-muted-foreground" aria-hidden />
          <h2 className="text-lg font-medium">No projects yet</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            {user?.isPlatformAdmin
              ? 'Projects you create will appear here.'
              : 'You are not a member of any project. Ask a project admin to invite you.'}
          </p>
        </div>
      ) : (
        <ul aria-label="Projects" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <li key={project.id}>
              <Link
                href={`/p/${project.slug}`}
                className="block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Card className="h-full transition-colors hover:border-primary">
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between gap-2">
                      <span>{project.name}</span>
                      {project.archivedAt && <Badge variant="secondary">Archived</Badge>}
                    </CardTitle>
                    <CardDescription>{project.slug}</CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
