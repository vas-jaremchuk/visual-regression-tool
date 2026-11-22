'use client';

import { useCallback, useRef, useState, type PointerEvent, type UIEvent } from 'react';
import { Button } from '@/components/ui/button';
import { imageSrc, itemPath } from '@/lib/comparisons/report';
import type { ReportItem } from '@/lib/comparisons/report-items';
import { cn } from '@/lib/utils';
import { SeverityBadge } from './SeverityBadge';

/** Viewer modes of F-CMP-4, in the order of the `1`-`4` keys. */
export const VIEWER_MODES = [
  { id: 'side-by-side', label: 'Side by side' },
  { id: 'slider', label: 'Slider' },
  { id: 'overlay', label: 'Overlay' },
  { id: 'diff', label: 'Diff only' },
] as const;
export type ViewerMode = (typeof VIEWER_MODES)[number]['id'];
export type Zoom = 'fit' | 'actual';

interface Props {
  item: ReportItem;
  comparisonId: string;
  publicUrl: string | null;
  beforeLabel: string;
  afterLabel: string;
  /** Public share token: images are signed with it instead of a session. */
  shareToken?: string;
  mode: ViewerMode;
  onModeChange: (mode: ViewerMode) => void;
}

/**
 * Item viewer (F-CMP-4, 08 §3): side-by-side (before / diff / after, prototype layout), slider,
 * overlay and diff only. Panes scroll together; zoom is fit width or 100 %. Full PNGs load lazily.
 */
export function ItemViewer({
  item,
  comparisonId,
  publicUrl,
  beforeLabel,
  afterLabel,
  shareToken,
  mode,
  onModeChange,
}: Props) {
  const [zoom, setZoom] = useState<Zoom>('fit');
  const [reveal, setReveal] = useState(50);
  const [opacity, setOpacity] = useState(50);
  const panes = useRef(new Set<HTMLDivElement>());
  const syncing = useRef(false);
  const dragging = useRef(false);

  const registerPane = useCallback((el: HTMLDivElement | null) => {
    if (el) panes.current.add(el);
  }, []);

  // Synchronised scroll: mirror the scrolled pane's position to the other panes.
  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    if (syncing.current) return;
    syncing.current = true;
    mirrorScroll(event.currentTarget, panes.current);
    requestAnimationFrame(() => {
      syncing.current = false;
    });
  }, []);

  const src = (key: string | null) =>
    key ? imageSrc(publicUrl, comparisonId, key, shareToken) : null;
  const label = itemPath(item.url, item.name);
  const before = src(item.beforeKey);
  const after = src(item.afterKey);
  const diff = src(item.diffKey);
  const imgClass = zoom === 'fit' ? 'block w-full h-auto max-w-none' : 'block max-w-none';

  const moveReveal = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left + event.currentTarget.scrollLeft;
    const width = event.currentTarget.scrollWidth || rect.width;
    setReveal(Math.round(Math.min(100, Math.max(0, (x / width) * 100))));
  };

  return (
    <section aria-label="Item viewer" className="grid min-w-0 gap-3" data-testid="item-viewer">
      <header className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 break-all text-base font-semibold">
            {item.url ? (
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                {label}
              </a>
            ) : (
              <span className="italic text-muted-foreground">{label}</span>
            )}
          </h2>
          {item.viewportSlug && (
            <span className="rounded-md border px-2 py-0.5 text-xs">{item.viewportSlug}</span>
          )}
          {item.diffPct !== null && <SeverityBadge pct={item.diffPct} />}
          <span className="text-xs text-muted-foreground">status: {item.status}</span>
        </div>
        {item.diffPixels !== null && item.totalPixels !== null && (
          <p className="text-xs text-muted-foreground tabular-nums">
            {item.diffPixels.toLocaleString('en')} px / {item.totalPixels.toLocaleString('en')}{' '}
            total
          </p>
        )}
        {item.error && (
          <p role="alert" className="text-sm text-destructive">
            {item.error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <div role="group" aria-label="Viewer mode" className="flex gap-1">
            {VIEWER_MODES.map((m, index) => (
              <Button
                key={m.id}
                size="sm"
                variant={mode === m.id ? 'default' : 'outline'}
                aria-pressed={mode === m.id}
                aria-keyshortcuts={String(index + 1)}
                onClick={() => onModeChange(m.id)}
              >
                {m.label}
              </Button>
            ))}
          </div>
          <div role="group" aria-label="Zoom" className="flex gap-1">
            <Button
              size="sm"
              variant={zoom === 'fit' ? 'secondary' : 'ghost'}
              aria-pressed={zoom === 'fit'}
              onClick={() => setZoom('fit')}
            >
              Fit width
            </Button>
            <Button
              size="sm"
              variant={zoom === 'actual' ? 'secondary' : 'ghost'}
              aria-pressed={zoom === 'actual'}
              onClick={() => setZoom('actual')}
            >
              100 %
            </Button>
          </div>
          {mode === 'slider' && (
            <label className="flex items-center gap-2 text-sm">
              Reveal before
              <input
                type="range"
                min={0}
                max={100}
                value={reveal}
                onChange={(e) => setReveal(Number(e.target.value))}
              />
              <span className="w-10 tabular-nums">{reveal} %</span>
            </label>
          )}
          {mode === 'overlay' && (
            <label className="flex items-center gap-2 text-sm">
              Before opacity
              <input
                type="range"
                min={0}
                max={100}
                value={opacity}
                onChange={(e) => setOpacity(Number(e.target.value))}
              />
              <span className="w-10 tabular-nums">{opacity} %</span>
            </label>
          )}
        </div>
      </header>

      {mode === 'side-by-side' && (
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-md border bg-border lg:grid-cols-3">
          <Figure title="Before" note={beforeLabel}>
            <Pane registerPane={registerPane} onScroll={onScroll}>
              <Img src={before} alt={`before ${label}`} className={imgClass} />
            </Pane>
          </Figure>
          <Figure title="Diff" note="changed pixels highlighted">
            <Pane registerPane={registerPane} onScroll={onScroll}>
              <Img src={diff} alt={`diff ${label}`} className={imgClass} />
            </Pane>
          </Figure>
          <Figure title="After" note={afterLabel}>
            <Pane registerPane={registerPane} onScroll={onScroll}>
              <Img src={after} alt={`after ${label}`} className={imgClass} />
            </Pane>
          </Figure>
        </div>
      )}

      {mode === 'slider' && (
        <Figure title="Before ↔ After" note={`${beforeLabel} ↔ ${afterLabel}`}>
          <Pane
            registerPane={registerPane}
            onScroll={onScroll}
            className="cursor-ew-resize touch-pan-y"
            onPointerDown={(e) => {
              dragging.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              moveReveal(e);
            }}
            onPointerMove={(e) => dragging.current && moveReveal(e)}
            onPointerUp={() => {
              dragging.current = false;
            }}
          >
            <div className={cn('relative', zoom === 'fit' ? 'w-full' : 'w-max')}>
              <Img src={after} alt={`after ${label}`} className={imgClass} />
              {before && (
                <div
                  className="absolute inset-0"
                  style={{ clipPath: `inset(0 ${100 - reveal}% 0 0)` }}
                  data-testid="slider-before"
                >
                  <Img src={before} alt={`before ${label}`} className={imgClass} />
                </div>
              )}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-y-0 w-0.5 bg-[#818cf8]"
                style={{ left: `${reveal}%` }}
              />
            </div>
          </Pane>
        </Figure>
      )}

      {mode === 'overlay' && (
        <Figure title="Overlay" note={`before at ${opacity} % over after`}>
          <Pane registerPane={registerPane} onScroll={onScroll}>
            <div className={cn('relative', zoom === 'fit' ? 'w-full' : 'w-max')}>
              <Img src={after} alt={`after ${label}`} className={imgClass} />
              {before && (
                <div
                  className="absolute inset-0"
                  style={{ opacity: opacity / 100 }}
                  data-testid="overlay-before"
                >
                  <Img src={before} alt={`before ${label}`} className={imgClass} />
                </div>
              )}
            </div>
          </Pane>
        </Figure>
      )}

      {mode === 'diff' && (
        <Figure title="Diff" note="changed pixels highlighted">
          <Pane registerPane={registerPane} onScroll={onScroll}>
            <Img src={diff} alt={`diff ${label}`} className={imgClass} />
          </Pane>
        </Figure>
      )}
    </section>
  );
}

/** Copies the scroll position of `source` to the other connected panes. */
function mirrorScroll(source: HTMLDivElement, panes: Set<HTMLDivElement>) {
  for (const pane of panes) {
    if (!pane.isConnected) panes.delete(pane);
    else if (pane !== source) {
      pane.scrollTop = source.scrollTop;
      pane.scrollLeft = source.scrollLeft;
    }
  }
}

function Figure({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <figure className="min-w-0 bg-[#0f1117] p-2">
      <figcaption className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
        {title} <small className="font-normal normal-case tracking-normal">({note})</small>
      </figcaption>
      {children}
    </figure>
  );
}

function Pane({
  registerPane,
  onScroll,
  className,
  children,
  ...rest
}: {
  registerPane: (el: HTMLDivElement | null) => void;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
  className?: string;
  children: React.ReactNode;
} & Pick<React.ComponentProps<'div'>, 'onPointerDown' | 'onPointerMove' | 'onPointerUp'>) {
  return (
    <div
      ref={registerPane}
      onScroll={onScroll}
      className={cn('max-h-[70vh] overflow-auto rounded border border-slate-700', className)}
      {...rest}
    >
      {children}
    </div>
  );
}

function Img({ src, alt, className }: { src: string | null; alt: string; className: string }) {
  if (!src) {
    return (
      <p className="p-6 text-center text-sm text-muted-foreground">
        No image ({alt.split(' ')[0]})
      </p>
    );
  }
  // Full R2 PNGs, possibly signed: next/image would proxy and re-encode them.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} loading="lazy" draggable={false} className={className} />;
}
