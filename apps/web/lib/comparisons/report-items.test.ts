import { describe, expect, it } from 'vitest';
import { isAutoReviewed } from './report-items';

describe('isAutoReviewed', () => {
  it('marks reviews the workflow set: no reviewer and an `auto:` note', () => {
    expect(isAutoReviewed('approved', null, 'auto: same as approved in a_vs_b')).toBe(true);
    expect(isAutoReviewed('ignored', null, 'auto: ignore rule')).toBe(true);
  });

  it('does not mark a person’s review, even with an `auto:` note, nor pending items', () => {
    expect(isAutoReviewed('approved', 'user-1', 'auto: typed by hand')).toBe(false);
    expect(isAutoReviewed('approved', null, null)).toBe(false);
    expect(isAutoReviewed('pending', null, 'auto: same as approved in a_vs_b')).toBe(false);
  });
});
