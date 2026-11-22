import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AccessPassword } from '@/components/projects/AccessPassword';
import { BucketChecks } from '@/components/projects/BucketChecks';
import { DangerZone } from '@/components/projects/DangerZone';
import { NotificationsPanel } from '@/components/projects/NotificationsPanel';
import { SettingsForm } from '@/components/projects/SettingsForm';
import { ViewportsPanel } from '@/components/projects/ViewportsPanel';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { listChannels } from '@/lib/notifications/queries';
import { canDo, requireProjectSettings } from '@/lib/projects/access';
import { listViewports } from '@/lib/projects/queries';
import { isSettingsGroup, settingsToForm } from '@/lib/projects/settings-groups';
import { SETTINGS_TABS } from '@/lib/projects/tabs';

type Params = Promise<{ slug: string; tab: string }>;

function tabOf(tab: string) {
  return SETTINGS_TABS.find((entry) => entry.tab === tab && entry.tab !== 'members');
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { tab } = await params;
  return { title: `${tabOf(tab)?.label ?? 'Settings'} · Visual Regression Tool` };
}

const DESCRIPTIONS: Record<string, string> = {
  general: 'Name, link slug and the sitemap the URL list is built from.',
  storage: 'The R2 bucket screenshots, diffs and reports are stored in.',
  access: 'Basic auth credentials sent when capturing a protected site.',
  capture: 'How pages are loaded and captured. Changes apply to new runs only.',
  viewports: 'Screen sizes every run captures. Disabled viewports are skipped.',
  diff: 'How sensitive comparisons are.',
  notifications:
    'Email and Slack messages when runs and comparisons finish. Failed deliveries are retried 3 times.',
  danger: 'Archive or delete the project.',
};

/** Project settings tabs (03 §6, 08 §1). Project admins only; others get a 403. */
export default async function SettingsTabPage({ params }: { params: Params }) {
  const { slug, tab } = await params;
  const entry = tabOf(tab);
  if (!entry) notFound();
  const { user, project } = await requireProjectSettings(slug);
  const archived = project.archivedAt !== null;

  let body: React.ReactNode;
  if ('later' in entry) {
    body = (
      <p className="text-sm text-muted-foreground">
        {entry.label} settings are not available yet; they arrive with ticket {entry.later}.
        {entry.tab === 'ignore-rules' && (
          <>
            {' '}
            See{' '}
            <Link className="underline" href={`/p/${slug}/ignore-rules`}>
              Ignore rules
            </Link>
            .
          </>
        )}
      </p>
    );
  } else if (entry.tab === 'viewports') {
    body = (
      <ViewportsPanel
        projectId={project.id}
        viewports={await listViewports(project.id)}
        disabled={archived}
      />
    );
  } else if (entry.tab === 'notifications') {
    const { channels, deliveries } = await listChannels(project.id);
    body = (
      <NotificationsPanel
        projectId={project.id}
        channels={channels}
        deliveries={deliveries}
        disabled={archived}
      />
    );
  } else if (entry.tab === 'danger') {
    body = (
      <DangerZone
        projectId={project.id}
        archived={archived}
        canArchive={await canDo(user, 'project.archive', project.id)}
      />
    );
  } else if (isSettingsGroup(entry.tab)) {
    const group = entry.tab;
    body = (
      <div className="grid gap-8">
        <SettingsForm
          projectId={project.id}
          slug={slug}
          group={group}
          initial={settingsToForm(group, project.settings)}
          locked={project.hasRuns ? { slug: 'The slug cannot change after the first run.' } : {}}
          disabled={archived}
        />
        {group === 'access' && (
          <AccessPassword
            projectId={project.id}
            hasPassword={project.hasBasicAuth}
            disabled={archived}
          />
        )}
        {group === 'storage' && <BucketChecks projectId={project.id} disabled={archived} />}
      </div>
    );
  } else {
    notFound();
  }

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">Settings</h1>
      {archived && entry.tab !== 'danger' && (
        <p role="status" className="rounded-md border p-3 text-sm text-muted-foreground">
          This project is archived and read-only. Unarchive it in the Danger zone to make changes.
        </p>
      )}
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{entry.label}</h2>
          </CardTitle>
          {DESCRIPTIONS[entry.tab] && <CardDescription>{DESCRIPTIONS[entry.tab]}</CardDescription>}
        </CardHeader>
        <CardContent>{body}</CardContent>
      </Card>
    </div>
  );
}
