'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { muteProject } from '@/app/(app)/account/actions';
import type { ProjectMute } from '@/lib/notifications/queries';

/** One "mute emails" switch per project the user can see (F-NOTIFY-5). */
export function NotificationMutes({ projects }: { projects: ProjectMute[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (projects.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">You are not a member of any project yet.</p>
    );
  }

  const toggle = (projectId: string, muted: boolean) =>
    startTransition(async () => {
      const result = await muteProject({ projectId, muted });
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
      router.refresh();
    });

  return (
    <ul className="grid gap-2" aria-label="Projects">
      {projects.map((project) => (
        <li key={project.projectId} className="flex items-center justify-between gap-3">
          <Link className="underline-offset-4 hover:underline" href={`/p/${project.slug}`}>
            {project.name}
          </Link>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={project.muted}
              disabled={pending}
              onChange={(event) => toggle(project.projectId, event.target.checked)}
            />
            Mute emails
          </label>
        </li>
      ))}
    </ul>
  );
}
