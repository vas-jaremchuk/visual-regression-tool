import { matchesUrlPattern } from '@vrt/engine/ignore-rules';
import type { IgnoreRuleType } from '@vrt/shared';

/** The fields of an ignore rule the pattern tester needs (F-IGNORE-2). */
export interface TestableRule {
  id: string;
  type: IgnoreRuleType;
  urlPattern: string | null;
  viewportSlug: string | null;
  appliesTo: 'capture' | 'compare' | 'both';
  enabled: boolean;
}

export interface RuleMatch<R extends TestableRule> {
  rule: R;
  /** What the rule does to this URL, in words. */
  effect: string;
}

function effectOf(rule: TestableRule): string {
  const where = rule.viewportSlug ? ` (${rule.viewportSlug} only)` : '';
  switch (rule.type) {
    case 'url_pattern':
      return (
        {
          capture: 'not captured',
          compare: 'changes ignored when comparing',
          both: 'not captured, changes ignored when comparing',
        }[rule.appliesTo] + where
      );
    case 'selector':
      return `element hidden before capture${where}`;
    case 'region':
      return `region masked before diff${where}`;
  }
}

/**
 * F-IGNORE-2: the rules that apply to `url`, with the same matching as the engine. A rule without
 * a URL pattern (selector or region) applies to every URL. With `viewportSlug`, rules scoped to
 * another viewport are left out. Disabled rules match too but are flagged by the caller.
 */
export function matchRules<R extends TestableRule>(
  rules: readonly R[],
  url: string,
  viewportSlug: string | null = null,
): RuleMatch<R>[] {
  const target = url.trim();
  if (!target) return [];
  return rules
    .filter(
      (rule) =>
        (viewportSlug === null || !rule.viewportSlug || rule.viewportSlug === viewportSlug) &&
        (rule.urlPattern
          ? matchesUrlPattern(rule.urlPattern, target)
          : rule.type !== 'url_pattern'),
    )
    .map((rule) => ({ rule, effect: effectOf(rule) }));
}
