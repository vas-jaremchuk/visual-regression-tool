import { describe, expect, it } from 'vitest';
import { assessActiveJobs, isStuck, lastProgressAt, type ActiveJobInput } from './job-health';

const NOW = new Date('2026-11-22T12:00:00.000Z');

function job(overrides: Partial<ActiveJobInput>): ActiveJobInput {
  return {
    kind: 'run',
    id: 'run-1',
    label: '2026-11-22_11-00-00',
    status: 'running',
    projectName: 'Acme',
    projectSlug: 'acme',
    totalItems: 10,
    doneItems: 3,
    failedItems: 0,
    createdAt: '2026-11-22T11:00:00.000Z',
    startedAt: '2026-11-22T11:00:05.000Z',
    lastItemAt: null,
    ...overrides,
  };
}

describe('lastProgressAt', () => {
  it('prefers the newest finished item over the start', () => {
    expect(lastProgressAt(job({ lastItemAt: '2026-11-22T11:50:00.000Z' }))).toBe(
      '2026-11-22T11:50:00.000Z',
    );
  });

  it('falls back to the start, then to the creation', () => {
    expect(lastProgressAt(job({}))).toBe('2026-11-22T11:00:05.000Z');
    expect(lastProgressAt(job({ startedAt: null }))).toBe('2026-11-22T11:00:00.000Z');
  });
});

describe('isStuck', () => {
  it('is stuck after more than 15 minutes without progress', () => {
    expect(isStuck('2026-11-22T11:44:59.000Z', NOW)).toBe(true);
    expect(isStuck('2026-11-22T11:45:00.000Z', NOW)).toBe(false);
    expect(isStuck('2026-11-22T11:59:00.000Z', NOW)).toBe(false);
  });
});

describe('assessActiveJobs', () => {
  it('flags a run with no progress for more than 15 minutes as stuck and lists it first', () => {
    const jobs = assessActiveJobs(
      [
        job({ id: 'fresh', lastItemAt: '2026-11-22T11:58:00.000Z' }),
        job({ id: 'stuck', lastItemAt: '2026-11-22T11:30:00.000Z' }),
        job({
          id: 'queued',
          status: 'queued',
          startedAt: null,
          createdAt: '2026-11-22T11:55:00.000Z',
        }),
      ],
      NOW,
    );
    expect(jobs.map((j) => [j.id, j.stuck])).toEqual([
      ['stuck', true],
      ['queued', false],
      ['fresh', false],
    ]);
    expect(jobs[0]!.lastProgressAt).toBe('2026-11-22T11:30:00.000Z');
  });
});
