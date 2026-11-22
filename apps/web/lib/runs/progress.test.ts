import { describe, expect, it } from 'vitest';
import {
  addSample,
  estimateEtaMs,
  estimateRunMs,
  ETA_WINDOW,
  formatBytes,
  formatDuration,
  groupFailures,
  viewportProgress,
} from './progress';

describe('viewportProgress', () => {
  it('sums statuses per viewport in run order, files last', () => {
    expect(
      viewportProgress(
        ['desktop', 'mobile'],
        [
          { viewportSlug: 'mobile', status: 'done', items: 2, bytes: 0 },
          { viewportSlug: null, status: 'failed', items: 1, bytes: 0 },
          { viewportSlug: 'desktop', status: 'done', items: 3, bytes: 0 },
          { viewportSlug: 'desktop', status: 'pending', items: 1, bytes: 0 },
          { viewportSlug: 'mobile', status: 'failed', items: 1, bytes: 0 },
        ],
      ),
    ).toEqual([
      { viewportSlug: 'desktop', total: 4, done: 3, failed: 0 },
      { viewportSlug: 'mobile', total: 3, done: 2, failed: 1 },
      { viewportSlug: null, total: 1, done: 0, failed: 1 },
    ]);
  });

  it('keeps a selected viewport without items', () => {
    expect(viewportProgress(['desktop'], [])).toEqual([
      { viewportSlug: 'desktop', total: 0, done: 0, failed: 0 },
    ]);
  });
});

describe('estimateEtaMs', () => {
  const counts = { total: 100, done: 40, failed: 10 };

  it('uses the moving average rate of the samples', () => {
    const samples = [
      { at: 0, processed: 30 },
      { at: 10_000, processed: 50 },
    ];
    // 20 items in 10 s → 2 items/s; 50 remaining → 25 s
    expect(estimateEtaMs(counts, samples, null, 10_000)).toBe(25_000);
  });

  it('falls back to the rate since the run started', () => {
    // 50 items in 100 s → 0.5 items/s; 50 remaining → 100 s
    expect(estimateEtaMs(counts, [], 0, 100_000)).toBe(100_000);
  });

  it('is 0 when nothing remains and null without a basis', () => {
    expect(estimateEtaMs({ total: 5, done: 5, failed: 0 }, [], null, 0)).toBe(0);
    expect(estimateEtaMs({ total: 5, done: 0, failed: 0 }, [], 0, 1000)).toBeNull();
  });
});

describe('addSample', () => {
  it('drops samples without progress and keeps a bounded window', () => {
    let samples = addSample([], { at: 0, processed: 1 });
    samples = addSample(samples, { at: 1, processed: 1 });
    expect(samples).toHaveLength(1);
    for (let i = 2; i < 30; i++) samples = addSample(samples, { at: i, processed: i });
    expect(samples).toHaveLength(ETA_WINDOW);
    expect(samples.at(-1)).toEqual({ at: 29, processed: 29 });
  });
});

describe('estimates and formatting', () => {
  it('divides the work by the concurrency', () => {
    expect(estimateRunMs(12, 5_000, 4)).toBe(15_000);
    expect(estimateRunMs(3, 5_000, 0)).toBe(15_000);
  });

  it('formats durations and sizes', () => {
    expect(formatDuration(12_400)).toBe('12 s');
    expect(formatDuration(250_000)).toBe('4 min 10 s');
    expect(formatDuration(3_900_000)).toBe('1 h 05 min');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(250 * 1024 * 1024)).toBe('250 MB');
  });
});

describe('groupFailures', () => {
  it('groups by message, largest group first', () => {
    const groups = groupFailures([
      { id: '1', url: 'https://a/', viewportSlug: 'desktop', error: 'Timeout' },
      { id: '2', url: 'https://b/', viewportSlug: 'desktop', error: 'HTTP 500' },
      { id: '3', url: 'https://c/', viewportSlug: 'mobile', error: 'Timeout ' },
      { id: '4', url: 'https://d/', viewportSlug: null, error: null },
    ]);
    expect(groups.map((g) => [g.error, g.items.length])).toEqual([
      ['Timeout', 2],
      ['HTTP 500', 1],
      ['Unknown error', 1],
    ]);
  });
});
