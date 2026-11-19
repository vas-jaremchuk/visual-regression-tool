import { describe, expect, it } from 'vitest';
import { safeNext } from './safe-next';

describe('safeNext', () => {
  it.each([
    ['/p/example-site/runs?tab=items', '/p/example-site/runs?tab=items'],
    ['/', '/'],
    [null, '/'],
    ['', '/'],
    ['https://evil.example', '/'],
    ['//evil.example/path', '/'],
    ['/\\evil.example', '/'],
    ['/login?next=/x', '/'],
    ['/auth/callback', '/'],
  ])('%s → %s', (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });
});
