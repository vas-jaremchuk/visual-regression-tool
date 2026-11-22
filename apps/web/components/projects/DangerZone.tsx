'use client';

import { Archive, ArchiveRestore, Loader2, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { archiveProject, deleteProjectAction } from '@/app/(app)/p/[slug]/settings/actions';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Danger zone (03 §6, F-PROJ-6): archive / unarchive and delete (platform admins). */
export function DangerZone({
  projectId,
  slug,
  archived,
  canArchive,
}: {
  projectId: string;
  slug: string;
  archived: boolean;
  canArchive: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [deleting, setDeleting] = useState(false);
  const [confirmSlug, setConfirmSlug] = useState('');
  const [deleteObjects, setDeleteObjects] = useState(false);

  function remove() {
    startTransition(async () => {
      const result = await deleteProjectAction({ projectId, confirmSlug, deleteObjects });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(result.message);
      setDeleting(false);
      if (result.data?.queued) router.refresh();
      else router.push('/');
    });
  }

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
        <Button
          type="button"
          variant="destructive"
          disabled={!canArchive || pending}
          onClick={() => {
            setConfirmSlug('');
            setDeleteObjects(false);
            setDeleting(true);
          }}
        >
          <Trash2 aria-hidden />
          Delete
        </Button>
      </section>

      <Dialog open={deleting} onOpenChange={(open) => !pending && setDeleting(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete project {slug}?</DialogTitle>
            <DialogDescription>
              Deletes the project with its runs, comparisons, members and settings. This cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <form
            id="delete-project-form"
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              remove();
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="delete-project-slug">
                Type <span className="font-mono">{slug}</span> to confirm
              </Label>
              <Input
                id="delete-project-slug"
                autoComplete="off"
                value={confirmSlug}
                onChange={(event) => setConfirmSlug(event.target.value)}
              />
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={deleteObjects}
                onChange={(event) => setDeleteObjects(event.target.checked)}
              />
              <span>
                Also delete R2 objects (screenshots, diffs and reports of its runs and comparisons).
                The bucket itself is kept.
              </span>
            </label>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(false)} disabled={pending}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="delete-project-form"
              variant="destructive"
              disabled={pending || confirmSlug !== slug}
            >
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              Delete project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
