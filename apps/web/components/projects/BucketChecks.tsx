'use client';

import { CheckCircle2, Globe, HardDrive, Loader2, XCircle } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { checkProjectBucket } from '@/app/(app)/p/[slug]/settings/actions';
import { Button } from '@/components/ui/button';
import type { BucketCheckResult } from '@/lib/projects/bucket-check';

function Status({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      {ok ? (
        <CheckCircle2 className="size-4 text-green-500" aria-hidden />
      ) : (
        <XCircle className="size-4 text-destructive" aria-hidden />
      )}
      <span>
        {ok ? 'OK' : 'Failed'}: {label}
      </span>
    </li>
  );
}

const PUBLIC_URL_TEXT = {
  ok: 'the probe object is served from the public URL',
  failed: 'the probe object could not be fetched from the public URL',
  not_configured: 'no public URL is set',
} as const;

/**
 * F-PROJ-5: *Check bucket* verifies the bucket exists and the credentials can write, read and
 * delete a probe; *Test public URL* also fetches the probe through the public URL. Both run the
 * same check; a missing bucket can be created from here.
 */
export function BucketChecks({ projectId, disabled }: { projectId: string; disabled: boolean }) {
  const [result, setResult] = useState<BucketCheckResult | null>(null);
  const [showPublic, setShowPublic] = useState(false);
  const [pending, startTransition] = useTransition();

  function run(create: boolean, withPublicUrl: boolean) {
    startTransition(async () => {
      const response = await checkProjectBucket({ projectId, create });
      if (!response.ok || !response.data) {
        toast.error(response.message);
        return;
      }
      setResult(response.data);
      setShowPublic(withPublicUrl);
      const failed = response.data.error || (withPublicUrl && response.data.publicUrl === 'failed');
      if (failed) toast.error(response.data.error ?? 'Public URL test failed');
      else toast.success(response.data.created ? 'Bucket created and checked' : 'Bucket checked');
    });
  }

  return (
    <section aria-labelledby="bucket-checks" className="grid gap-3">
      <h2 id="bucket-checks" className="text-sm font-medium">
        Checks
      </h2>
      <p className="text-sm text-muted-foreground">Save changes before running a check.</p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={disabled || pending}
          onClick={() => run(false, false)}
        >
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <HardDrive aria-hidden />}
          Check bucket
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={disabled || pending}
          onClick={() => run(false, true)}
        >
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Globe aria-hidden />}
          Test public URL
        </Button>
      </div>
      {result && (
        <div aria-live="polite" className="grid gap-2 rounded-md border p-3">
          <ul className="grid gap-1">
            <Status
              ok={result.exists}
              label={
                result.created
                  ? 'bucket created'
                  : result.exists
                    ? 'bucket exists'
                    : 'bucket does not exist'
              }
            />
            {result.exists && (
              <Status
                ok={result.canReadWriteDelete}
                label="write, read and delete a probe object"
              />
            )}
            {showPublic && (
              <Status ok={result.publicUrl === 'ok'} label={PUBLIC_URL_TEXT[result.publicUrl]} />
            )}
          </ul>
          {result.error && <p className="text-sm text-muted-foreground">{result.error}</p>}
          {!result.exists && (
            <div>
              <Button
                type="button"
                disabled={disabled || pending}
                onClick={() => run(true, showPublic)}
              >
                Create bucket
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
