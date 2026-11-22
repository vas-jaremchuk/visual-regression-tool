'use client';

import type { ReviewStatus } from '@vrt/shared';
import { Check, EyeOff, Loader2, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ReportItem } from '@/lib/comparisons/report-items';

/** Review actions in toolbar order; `key` is the keyboard shortcut (08 §3, F-REVIEW-1). */
export const REVIEW_ACTIONS: {
  review: Exclude<ReviewStatus, 'pending'>;
  label: string;
  key: string;
  icon: typeof Check;
}[] = [
  { review: 'approved', label: 'Approve', key: 'a', icon: Check },
  { review: 'rejected', label: 'Reject', key: 'r', icon: X },
  { review: 'ignored', label: 'Ignore', key: 'i', icon: EyeOff },
];

/** Review toolbar of the item viewer (F-REVIEW-1): approve / reject / ignore with a note. */
export function ReviewToolbar({
  item,
  note,
  onNoteChange,
  pending,
  onReview,
}: {
  item: ReportItem;
  note: string;
  onNoteChange: (note: string) => void;
  /** The review being saved, if any. */
  pending: ReviewStatus | null;
  onReview: (review: ReviewStatus) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Review"
      data-testid="review-toolbar"
      className="flex flex-wrap items-end gap-2 rounded-md border p-2"
    >
      {REVIEW_ACTIONS.map(({ review, label, key, icon: Icon }) => (
        <Button
          key={review}
          size="sm"
          variant={item.review === review ? 'default' : 'outline'}
          aria-pressed={item.review === review}
          aria-keyshortcuts={key}
          disabled={pending !== null}
          onClick={() => onReview(review)}
        >
          {pending === review ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <Icon aria-hidden />
          )}
          {label}
        </Button>
      ))}
      {item.review !== 'pending' && (
        <Button
          size="sm"
          variant="ghost"
          disabled={pending !== null}
          onClick={() => onReview('pending')}
        >
          {pending === 'pending' ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <RotateCcw aria-hidden />
          )}
          Reset
        </Button>
      )}
      <div className="grid min-w-48 flex-1 gap-1">
        <Label htmlFor="review-note" className="text-xs">
          Note (optional)
        </Label>
        <Input
          id="review-note"
          value={note}
          maxLength={1000}
          onChange={(e) => onNoteChange(e.target.value)}
          placeholder="Why this review"
          className="h-8"
        />
      </div>
      <p className="w-full text-xs text-muted-foreground">
        Review: <span className="font-medium">{item.review}</span>
        {item.reviewNote && ` · “${item.reviewNote}”`} · keys a / r / i
      </p>
    </div>
  );
}
