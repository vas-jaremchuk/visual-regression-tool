import { describe, expect, it } from 'vitest';
import { isPublicPath } from './public-paths';

describe('isPublicPath', () => {
  it.each([
    '/login',
    '/auth/callback',
    '/invite/abc',
    '/share/token',
    '/api/share/token/items',
    '/api/r2/sign',
  ])('%s is public', (path) => {
    expect(isPublicPath(path)).toBe(true);
  });

  it.each([
    '/',
    '/p/example-site',
    '/admin/users',
    '/account',
    '/login-other',
    '/shared',
    '/api/comparisons/x/share',
  ])('%s needs a session', (path) => {
    expect(isPublicPath(path)).toBe(false);
  });
});
