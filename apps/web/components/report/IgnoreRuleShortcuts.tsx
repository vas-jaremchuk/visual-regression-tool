'use client';

import { EyeOff, Link2Off, SquareDashed } from 'lucide-react';
import { useState } from 'react';
import {
  EMPTY_DRAFT,
  IgnoreRuleDialog,
  type RuleDraft,
} from '@/components/ignore-rules/IgnoreRuleDialog';
import { Button } from '@/components/ui/button';
import { imageSrc } from '@/lib/comparisons/report';
import type { ReportItem } from '@/lib/comparisons/report-items';

type Shortcut = 'url' | 'selector' | 'region';

/** The prefilled rule of each shortcut (F-REVIEW-3). */
export function shortcutDraft(
  shortcut: Shortcut,
  item: { url: string; viewportSlug: string | null },
): RuleDraft {
  switch (shortcut) {
    case 'url':
      return { ...EMPTY_DRAFT, type: 'url_pattern', urlPattern: item.url, appliesTo: 'both' };
    case 'selector':
      return { ...EMPTY_DRAFT, type: 'selector', urlPattern: item.url };
    case 'region':
      return {
        ...EMPTY_DRAFT,
        type: 'region',
        urlPattern: item.url,
        viewportSlug: item.viewportSlug ?? '',
      };
  }
}

const TITLES: Record<Shortcut, string> = {
  url: 'Ignore this URL',
  selector: 'Hide an element',
  region: 'Ignore a region',
};

/**
 * Item viewer shortcuts (F-REVIEW-3, 08 §3): ignore this URL, hide an element by selector, and
 * draw a region on the after image (scoped to this URL and viewport). Editor+.
 */
export function IgnoreRuleShortcuts({
  item,
  projectId,
  comparisonId,
  publicUrl,
  viewports,
}: {
  item: ReportItem & { url: string };
  projectId: string;
  comparisonId: string;
  publicUrl: string | null;
  viewports: string[];
}) {
  const [open, setOpen] = useState<Shortcut | null>(null);
  const after = item.afterKey ? imageSrc(publicUrl, comparisonId, item.afterKey) : null;

  return (
    <div
      role="group"
      aria-label="Ignore rule shortcuts"
      className="flex flex-wrap items-center gap-2"
    >
      <span className="text-xs text-muted-foreground">New rule:</span>
      <Button size="sm" variant="outline" onClick={() => setOpen('url')}>
        <Link2Off aria-hidden />
        Ignore this URL
      </Button>
      <Button size="sm" variant="outline" onClick={() => setOpen('selector')}>
        <EyeOff aria-hidden />
        Hide element
      </Button>
      <Button size="sm" variant="outline" onClick={() => setOpen('region')} disabled={!after}>
        <SquareDashed aria-hidden />
        Ignore region
      </Button>
      {open && (
        <IgnoreRuleDialog
          projectId={projectId}
          open
          onOpenChange={(next) => !next && setOpen(null)}
          initial={shortcutDraft(open, item)}
          viewports={viewports}
          title={TITLES[open]}
          image={open === 'region' && after ? { src: after, alt: `after ${item.url}` } : null}
        />
      )}
      <p className="w-full text-xs text-muted-foreground">
        Rules apply to new runs and comparisons; re-diff this comparison to apply them here.
      </p>
    </div>
  );
}
