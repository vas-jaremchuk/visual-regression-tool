import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IgnoreRule } from '@vrt/engine';
import { regionsFor } from '@vrt/engine/ignore-rules';
import { PROJECT_DEFAULTS } from '@vrt/shared';
import { FakeObjectStore } from '@vrt/storage/testing';
import { describe, expect, it } from 'vitest';
import { runDiff } from './diff.ts';

/**
 * T19 acceptance: a `region` ignore rule makes a previously changed fixture item unchanged when
 * the comparison is diffed again. The regions come from the comparison's rules snapshot exactly
 * as the diff consumer builds them (`regionsFor`), and the container masks them before diffing.
 */

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures');
const png = (name: string) => new Uint8Array(fs.readFileSync(path.join(FIXTURES, 'png', name)));

const BUCKET = 'vrt-test';
const URL = 'https://www.example.com/pricing/';

async function diffWith(rules: IgnoreRule[]) {
  const store = new FakeObjectStore();
  await store.put(
    BUCKET,
    'screenshots/a/desktop/pricing.png',
    png('block-change-a.png'),
    'image/png',
  );
  await store.put(
    BUCKET,
    'screenshots/b/desktop/pricing.png',
    png('block-change-b.png'),
    'image/png',
  );
  const result = await runDiff(store, {
    bucket: BUCKET,
    beforeKey: 'screenshots/a/desktop/pricing.png',
    afterKey: 'screenshots/b/desktop/pricing.png',
    diffKey: 'diffs/a_vs_b/desktop/pricing.png',
    threshold: PROJECT_DEFAULTS.diffThreshold,
    changeThresholdPct: PROJECT_DEFAULTS.changeThresholdPct,
    regions: regionsFor(rules, URL, 'desktop'),
  });
  const diffStored = await store.get(BUCKET, 'diffs/a_vs_b/desktop/pricing.png').then(
    () => true,
    () => false,
  );
  return { result, diffStored };
}

describe('region ignore rule on re-diff', () => {
  // The block-change fixture pair differs in the 16×16 block at (40, 20).
  const region = { x: 40, y: 20, width: 16, height: 16 };

  it('the fixture pair is changed without rules', async () => {
    const { result, diffStored } = await diffWith([]);
    expect(result.changed).toBe(true);
    expect(result.diffPixels).toBe(256);
    expect(diffStored).toBe(true);
  });

  it('is unchanged once a region rule for its URL and viewport covers the change', async () => {
    const { result, diffStored } = await diffWith([
      {
        type: 'region',
        region,
        url_pattern: 'https://www.example.com/pricing/',
        viewport_slug: 'desktop',
      },
    ]);
    expect(result).toMatchObject({ changed: false, diffPixels: 0, diffPct: 0 });
    expect(diffStored).toBe(false);
  });

  it('ignores region rules of another viewport, another URL or disabled ones', async () => {
    for (const rule of [
      { type: 'region', region, viewport_slug: 'mobile' },
      { type: 'region', region, url_pattern: 'https://www.example.com/blog/**' },
      { type: 'region', region, enabled: false },
    ] satisfies IgnoreRule[]) {
      const { result } = await diffWith([rule]);
      expect(result.changed, JSON.stringify(rule)).toBe(true);
    }
  });
});
