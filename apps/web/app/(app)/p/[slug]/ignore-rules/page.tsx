import type { Metadata } from 'next';
import { forbidden, notFound } from 'next/navigation';
import { IgnoreRulesPanel } from '@/components/ignore-rules/IgnoreRulesPanel';
import { PatternTester } from '@/components/ignore-rules/PatternTester';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/session';
import { listIgnoreRules } from '@/lib/ignore-rules/queries';
import { canDo } from '@/lib/projects/access';
import { getProjectDetail, listViewports } from '@/lib/projects/queries';

export const metadata: Metadata = { title: 'Ignore rules · Visual Regression Tool' };

/** Ignore rules (F-IGNORE-1/2, 08 §1): viewer+ reads and tests, editor+ manages. */
export default async function IgnoreRulesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireUser();
  const project = await getProjectDetail(slug);
  if (!project) notFound();
  if (!(await canDo(user, 'project.view', project.id))) forbidden();
  const [rules, viewports, canManage] = await Promise.all([
    listIgnoreRules(project.id),
    listViewports(project.id),
    canDo(user, 'ignore_rule.manage', project.id),
  ]);
  const slugs = viewports.map((v) => v.slug);
  const archived = Boolean(project.archivedAt);

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Ignore rules</h1>
        <p className="text-sm text-muted-foreground">
          URLs left out of capture or review, elements hidden before the screenshot and regions
          masked before the diff. Each run and comparison keeps a copy of the rules it used.
        </p>
        {archived && canManage && (
          <p className="mt-2 text-sm text-muted-foreground">
            The project is archived; unarchive it to change its rules.
          </p>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Rules</h2>
          </CardTitle>
          <CardDescription>Disabled rules are kept but not applied.</CardDescription>
        </CardHeader>
        <CardContent>
          <IgnoreRulesPanel
            projectId={project.id}
            rules={rules}
            viewports={slugs}
            canEdit={canManage && !archived}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Pattern tester</h2>
          </CardTitle>
          <CardDescription>Shows which rules match a URL.</CardDescription>
        </CardHeader>
        <CardContent>
          <PatternTester rules={rules} viewports={slugs} />
        </CardContent>
      </Card>
    </div>
  );
}
