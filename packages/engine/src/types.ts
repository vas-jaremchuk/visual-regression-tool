import type { IgnoreRuleType, Region } from '@vrt/shared';

/** `fetch`-compatible function injected into every engine function that does network I/O. */
export type Fetcher = typeof fetch;

export type IgnoreRuleAppliesTo = 'capture' | 'compare' | 'both';

/** Subset of an `ignore_rules` row (specification/02-data-model.md) the engine needs. */
export interface IgnoreRule {
  type: IgnoreRuleType;
  url_pattern?: string | null;
  selector?: string | null;
  region?: Region | null;
  viewport_slug?: string | null;
  applies_to?: IgnoreRuleAppliesTo | null;
  enabled?: boolean | null;
}

/** Capture-related project settings used by `buildInjectedCss`. */
export interface CaptureCssSettings {
  extra_css?: string | null;
  hide_selectors?: readonly string[] | null;
}
