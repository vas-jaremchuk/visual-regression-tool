import { describe, expect, it } from 'vitest';
import { isPublicPath } from './public-paths';

describe('isPublicPath', () => {
  it.each(['/login', '/auth/callback', '/invite/abc', '/share/token'])('%s is public', (path) => {
    expect(isPublicPath(path)).toBe(true);
  });

  it.each(['/', '/p/example-site', '/admin/users', '/account', '/login-other', '/shared'])(
    '%s needs a session',
    (path) => {
      expect(isPublicPath(path)).toBe(false);
    },
  );
});
