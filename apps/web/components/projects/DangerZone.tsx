'use client';

import { Archive, ArchiveRestore, Loader2, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { archiveProject } from '@/app/(app)/p/[slug]/settings/actions';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** Danger zone (03 §6, F-PROJ-6): archive / unarchive; delete arrives with T22. */
export function DangerZone({
  projectId,
  archived,
  canArchive,
}: {
  projectId: string;
  archived: boolean;
  canArchive: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function toggleArchive() {
    startTransition(async () => {
      const result = await archiveProject({ projectId, archived: !archived });
      if (result.ok) {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <div className="grid gap-4">
      <section
        aria-labelledby="archive-project"
        className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-destructive/40 p-4"
      >
        <div className="grid gap-1">
          <h2 id="archive-project" className="text-sm font-medium">
            {archived ? 'Unarchive project' : 'Archive project'}
          </h2>
          <p className="text-sm text-muted-foreground">
            {archived
              ? 'The project is read-only and hidden from the project list. Unarchive it to change settings again.'
              : 'Makes the project read-only and hides it from the project list. Nothing is deleted.'}
          </p>
          {!canArchive && (
            <p className="text-sm text-muted-foreground">
              Only platform admins can archive projects.
            </p>
          )}
        </div>
        <Button
          type="button"
          variant={archived ? 'outline' : 'destructive'}
          disabled={!canArchive || pending}
          onClick={toggleArchive}
        >
          {pending ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : archived ? (
            <ArchiveRestore aria-hidden />
          ) : (
            <Archive aria-hidden />
          )}
          {archived ? 'Unarchive' : 'Archive'}
        </Button>
      </section>
      <section
        aria-labelledby="delete-project"
        className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-destructive/40 p-4"
      >
        <div className="grid gap-1">
          <h2 id="delete-project" className="text-sm font-medium">
            Delete project
          </h2>
          <p className="text-sm text-muted-foreground">
            Deletes the project and its runs. R2 objects are kept unless you choose to delete them
            too.
          </p>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            {/* A disabled button gets no pointer events, so the wrapper carries the tooltip. */}
            <span tabIndex={0}>
              <Button type="button" variant="destructive" disabled>
                <Trash2 aria-hidden />
                Delete
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>Deleting projects is not available yet.</TooltipContent>
        </Tooltip>
      </section>
    </div>
  );
}
