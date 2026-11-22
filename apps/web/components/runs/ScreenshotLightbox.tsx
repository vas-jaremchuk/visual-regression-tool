'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

/**
 * F-RUN-3: 80 px thumbnail of a captured screenshot that opens the full image in a lightbox.
 * v1 has no thumbnails in R2 (08 §3), so both load the full PNG lazily.
 */
export function ScreenshotLightbox({
  src,
  url,
  viewport,
  truncated,
  height,
}: {
  src: string;
  url: string;
  viewport: string | null;
  truncated: boolean;
  height: number | null;
}) {
  const [open, setOpen] = useState(false);
  const alt = `Screenshot of ${url}${viewport ? ` (${viewport})` : ''}`;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={`Open screenshot of ${url}${viewport ? ` (${viewport})` : ''}`}
          className="block h-20 w-20 overflow-hidden rounded border bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- signed R2 URLs, no optimizer */}
          <img src={src} alt={alt} loading="lazy" className="w-20 object-cover object-top" />
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[95vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="break-all">{url}</DialogTitle>
          <DialogDescription>
            {viewport ?? 'file'}
            {truncated && height ? ` · truncated at ${height} px` : ''}
          </DialogDescription>
        </DialogHeader>
        {open && (
          // eslint-disable-next-line @next/next/no-img-element -- signed R2 URLs, no optimizer
          <img src={src} alt={alt} loading="lazy" className="h-auto w-full" />
        )}
      </DialogContent>
    </Dialog>
  );
}
