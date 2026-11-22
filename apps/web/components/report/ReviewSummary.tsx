'use client';

import { Flag, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { isFullyReviewed, reviewProgress, type ReviewCounts } from '@/lib/comparisons/report';

/**
 * Review progress of the report (F-REVIEW-4): "n/m reviewed", and once no changed item is pending
 * a banner offering *Promote after-run to baseline* (F-REVIEW-5) to editors.
 */
export function ReviewSummary({
  reviewCounts,
  afterRunId,
  afterLabel,
  afterIsBaseline,
  canSetBaseline,
}: {
  reviewCounts: Partial<ReviewCounts>;
  afterRunId: string;
  afterLabel: string;
  afterIsBaseline: boolean;
  canSetBaseline: boolean;
}) {
  const router = useRouter();
  const [promoting, setPromoting] = useState(false);
  const progress = reviewProgress(reviewCounts);

  async function promote() {
    setPromoting(true);
    try {
      const res = await fetch(`/api/runs/${afterRunId}/baseline`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      const body = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      if (!res.ok) {
        toast.error(body?.error?.message ?? 'Could not set the baseline');
        return;
      }
      toast.success(`${afterLabel} is now the baseline`);
      router.refresh();
    } catch {
      toast.error('Could not reach the server. Try again.');
    } finally {
      setPromoting(false);
    }
  }

  const promoteButton = canSetBaseline && !afterIsBaseline && (
    <Button size="sm" variant="outline" onClick={() => void promote()} disabled={promoting}>
      {promoting ? <Loader2 className="animate-spin" aria-hidden /> : <Flag aria-hidden />}
      Promote to baseline
    </Button>
  );

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground tabular-nums" data-testid="review-progress">
          {progress.total === 0
            ? 'No changed items to review'
            : `${progress.reviewed}/${progress.total} reviewed`}
          {progress.total > 0 &&
            ` · ${reviewCounts.approved ?? 0} approved · ${reviewCounts.rejected ?? 0} rejected · ${reviewCounts.ignored ?? 0} ignored`}
        </p>
        {!isFullyReviewed(reviewCounts) && promoteButton}
      </div>
      {isFullyReviewed(reviewCounts) && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-[#14532d] bg-[#1a2e22] px-4 py-3 text-sm text-[#4ade80]"
        >
          <span className="font-medium">
            ✅ Fully reviewed: no changed items are pending.
            {afterIsBaseline && ` ${afterLabel} is the baseline.`}
          </span>
          {canSetBaseline && !afterIsBaseline && (
            <Button size="sm" onClick={() => void promote()} disabled={promoting}>
              {promoting ? <Loader2 className="animate-spin" aria-hidden /> : <Flag aria-hidden />}
              Promote {afterLabel} to baseline
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
