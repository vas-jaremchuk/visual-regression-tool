/** Page capture helpers (specification/05-engine.md §4, REQ-ENG-4). Browser code lives in T11. */
import { selectorsFor } from './ignore-rules';
import type { CaptureCssSettings, IgnoreRule } from './types';

/** Kills cookie/consent banners and freezes animations. Verbatim from the prototype. */
export const NORMALISE_CSS = `
  [class*="cookie" i], [class*="consent" i], [class*="gdpr" i],
  [id*="cookie" i],   [id*="consent" i],    [id*="gdpr" i],
  .cc-window, .cc-banner, .pum-overlay, .pum-container,
  #onetrust-banner-sdk, .optanon-alert-box-wrapper,
  .cookie-notice, .cookie-popup, .cookie-bar { display: none !important; }

  *, *::before, *::after {
    animation-play-state:  paused   !important;
    animation-duration:    0.001ms  !important;
    animation-delay:       0ms      !important;
    transition-duration:   0.001ms  !important;
    transition-delay:      0ms      !important;
  }
  video { display: none !important; }
`;

/**
 * CSS injected after navigation: `NORMALISE_CSS` + project `extra_css` + `visibility: hidden`
 * for every `hide_selectors` entry and every enabled `selector` rule matching URL/viewport.
 */
export function buildInjectedCss(
  project: CaptureCssSettings,
  rules: readonly IgnoreRule[],
  url: string,
  viewportSlug: string | null,
): string {
  const parts = [NORMALISE_CSS];
  if (project.extra_css?.trim()) parts.push(project.extra_css);
  const selectors = [...(project.hide_selectors ?? []), ...selectorsFor(rules, url, viewportSlug)]
    .map((s) => s.trim())
    .filter(Boolean);
  for (const selector of new Set(selectors)) {
    parts.push(`${selector} { visibility: hidden !important; }`);
  }
  return parts.join('\n');
}

export const LAZY_LOAD_STEP_PX = 600;
export const LAZY_LOAD_DELAY_MS = 120;
export const IMAGE_TIMEOUT_MS = 5000;

export interface LazyLoadOptions {
  stepPx?: number;
  delayMs?: number;
  imageTimeoutMs?: number;
}

/**
 * Source of an async function expression for `page.evaluate`: scrolls by `stepPx` every
 * `delayMs` until `scrollY >= body.scrollHeight`, returns to the top, then waits for every
 * `<img>` to load or fail (with a per-image safety timeout).
 */
export function lazyLoadScript(opts: LazyLoadOptions = {}): string {
  const step = Number(opts.stepPx ?? LAZY_LOAD_STEP_PX);
  const delay = Number(opts.delayMs ?? LAZY_LOAD_DELAY_MS);
  const imageTimeout = Number(opts.imageTimeoutMs ?? IMAGE_TIMEOUT_MS);
  return `async () => {
  await new Promise(resolve => {
    const step = ${step}, delay = ${delay};
    let y = 0;
    const tick = setInterval(() => {
      window.scrollBy(0, step);
      y += step;
      if (y >= document.body.scrollHeight) {
        clearInterval(tick);
        window.scrollTo(0, 0);
        resolve();
      }
    }, delay);
  });
  const imgs = Array.from(document.querySelectorAll('img'));
  await Promise.allSettled(
    imgs.map(img => {
      if (img.complete && img.naturalWidth > 0) return Promise.resolve();
      return new Promise(res => {
        img.addEventListener('load', res, { once: true });
        img.addEventListener('error', res, { once: true });
        setTimeout(res, ${imageTimeout});
      });
    })
  );
}`;
}
