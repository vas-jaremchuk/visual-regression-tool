import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JOB_START_RATE_LIMIT_PER_MINUTE } from '@vrt/shared';
import { describe, expect, it } from 'vitest';
import { JOB_START_RATE_LIMIT } from './service';

/**
 * Every job start endpoint (09 §1) counts against the per-user job start limit (NFR-17) before it
 * starts a worker job. A new job start route belongs in this list.
 */
const JOB_START_ROUTES = [
  'app/api/projects/[id]/sitemap/route.ts',
  'app/api/projects/[id]/runs/route.ts',
  'app/api/projects/[id]/comparisons/route.ts',
  'app/api/projects/[id]/import-legacy/route.ts',
  'app/api/projects/[id]/storage/refresh/route.ts',
  'app/api/runs/[id]/retry-failed/route.ts',
];

const WEB = fileURLToPath(new URL('../..', import.meta.url));

describe('job start rate limit coverage (NFR-17)', () => {
  it('limits job starts to 10 per minute per user', () => {
    expect(JOB_START_RATE_LIMIT_PER_MINUTE).toBe(10);
    expect(JOB_START_RATE_LIMIT).toEqual({ bucket: 'job_start', limit: 10, windowSeconds: 60 });
  });

  it.each(JOB_START_ROUTES)('%s calls limitJobStart before starting the job', (route) => {
    const source = readFileSync(WEB + route, 'utf8');
    const limit = source.indexOf('limitJobStart(user)');
    expect(limit).toBeGreaterThan(0);
    const start = source.search(
      /(startSnapshot|startRun|startComparison|importLegacyLabels|refreshStorage|retryFailed)\(user/,
    );
    expect(start).toBeGreaterThan(limit);
  });
});
