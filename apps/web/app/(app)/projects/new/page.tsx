import type { Metadata } from 'next';
import { forbidden } from 'next/navigation';
import { CreateProjectForm } from '@/components/projects/CreateProjectForm';
import { Card, CardContent } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/session';
import { canDo } from '@/lib/projects/access';

export const metadata: Metadata = { title: 'New project · Visual Regression Tool' };

/** F-PROJ-1, F-PROJ-4: platform admins create projects, optionally from a prototype `.env`. */
export default async function NewProjectPage() {
  const user = await requireUser();
  if (!(await canDo(user, 'project.create', null))) forbidden();
  return (
    <div className="mx-auto grid max-w-2xl gap-6">
      <div>
        <h1 className="text-2xl font-semibold">New project</h1>
        <p className="text-sm text-muted-foreground">
          One project per website. Everything else can be changed later in the settings.
        </p>
      </div>
      <Card>
        <CardContent>
          <CreateProjectForm />
        </CardContent>
      </Card>
    </div>
  );
}
