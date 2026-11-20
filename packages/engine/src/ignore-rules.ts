/**
 * Ignore-rule matching (specification/02-data-model.md `ignore_rules`, F-IGNORE).
 * `url_pattern` is a glob (`*` = any chars except `/`, `**` = any chars) matched against the
 * full URL, or a `re:`-prefixed regular expression.
 */
import type { Region } from '@vrt/shared';
import type { IgnoreRule } from './types';

export type RulePhase = 'capture' | 'compare';

const globCache = new Map<string, RegExp | null>();

function compilePattern(pattern: string): RegExp | null {
  const cached = globCache.get(pattern);
  if (cached !== undefined) return cached;
  let re: RegExp | null;
  if (pattern.startsWith('re:')) {
    try {
      re = new RegExp(pattern.slice(3));
    } catch {
      re = null;
    }
  } else {
    let src = '';
    for (let i = 0; i < pattern.length; i++) {
      const c = pattern[i]!;
      if (c === '*') {
        if (pattern[i + 1] === '*') {
          src += '.*';
          i++;
        } else {
          src += '[^/]*';
        }
      } else {
        src += c.replace(/[.+?^${}()|[\]\\/-]/g, '\\$&');
      }
    }
    re = new RegExp(`^${src}$`);
  }
  globCache.set(pattern, re);
  return re;
}

/** True if `url` matches the pattern. An invalid `re:` pattern matches nothing. */
export function matchesUrlPattern(pattern: string, url: string): boolean {
  return compilePattern(pattern)?.test(url) ?? false;
}

function inScope(rule: IgnoreRule, url: string, viewportSlug: string | null | undefined): boolean {
  if (rule.enabled === false) return false;
  if (rule.viewport_slug && viewportSlug !== undefined && rule.viewport_slug !== viewportSlug) {
    return false;
  }
  return !rule.url_pattern || matchesUrlPattern(rule.url_pattern, url);
}

/**
 * The enabled `url_pattern` rules that exclude `url` in the given phase
 * (`applies_to` = phase or `both`; `both` when unset).
 */
export function matchingUrlRules<R extends IgnoreRule>(
  rules: readonly R[],
  url: string,
  phase: RulePhase,
  viewportSlug?: string | null,
): R[] {
  return rules.filter(
    (r) =>
      r.type === 'url_pattern' &&
      !!r.url_pattern &&
      (!r.applies_to || r.applies_to === 'both' || r.applies_to === phase) &&
      inScope(r, url, viewportSlug),
  );
}

/** True if any enabled `url_pattern` rule excludes `url` in the given phase. */
export function isUrlIgnored(
  rules: readonly IgnoreRule[],
  url: string,
  phase: RulePhase,
  viewportSlug?: string | null,
): boolean {
  return matchingUrlRules(rules, url, phase, viewportSlug).length > 0;
}

/** CSS selectors of enabled `selector` rules for this URL and viewport. */
export function selectorsFor(
  rules: readonly IgnoreRule[],
  url: string,
  viewportSlug: string | null,
): string[] {
  return rules
    .filter((r) => r.type === 'selector' && !!r.selector && inScope(r, url, viewportSlug))
    .map((r) => r.selector as string);
}

/** Regions of enabled `region` rules for this URL and viewport. */
export function regionsFor(
  rules: readonly IgnoreRule[],
  url: string,
  viewportSlug: string | null,
): Region[] {
  return rules
    .filter((r) => r.type === 'region' && !!r.region && inScope(r, url, viewportSlug))
    .map((r) => r.region as Region);
}
