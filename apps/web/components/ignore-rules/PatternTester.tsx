'use client';

import { useState } from 'react';
import { selectClassName } from '@/components/members/role-select-class';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { IgnoreRuleRow } from '@/lib/ignore-rules/queries';
import { matchRules } from '@/lib/ignore-rules/tester';
import { rulePreview } from './IgnoreRulesPanel';

/** F-IGNORE-2: type a URL and see which rules match it, with the engine's matching. */
export function PatternTester({
  rules,
  viewports,
}: {
  rules: IgnoreRuleRow[];
  viewports: string[];
}) {
  const [url, setUrl] = useState('');
  const [viewport, setViewport] = useState('');
  const matches = matchRules(rules, url, viewport || null);

  return (
    <div className="grid gap-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_12rem]">
        <div className="grid gap-1">
          <Label htmlFor="tester-url">URL</Label>
          <Input
            id="tester-url"
            type="url"
            className="font-mono"
            placeholder="https://www.example.com/page"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="tester-viewport">Viewport</Label>
          <select
            id="tester-viewport"
            className={selectClassName}
            value={viewport}
            onChange={(e) => setViewport(e.target.value)}
          >
            <option value="">Any viewport</option>
            {viewports.map((slug) => (
              <option key={slug} value={slug}>
                {slug}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div aria-live="polite" data-testid="tester-result">
        {url.trim() === '' ? (
          <p className="text-sm text-muted-foreground">Enter a URL to test the rules.</p>
        ) : matches.length === 0 ? (
          <p className="text-sm">No rule matches this URL.</p>
        ) : (
          <ul aria-label="Matching rules" className="grid gap-1 text-sm">
            {matches.map(({ rule, effect }) => (
              <li key={rule.id} className="flex flex-wrap items-center gap-2">
                <span className="font-mono break-all">{rulePreview(rule)}</span>
                <span className="text-muted-foreground">{effect}</span>
                {!rule.enabled && <Badge variant="outline">disabled</Badge>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
