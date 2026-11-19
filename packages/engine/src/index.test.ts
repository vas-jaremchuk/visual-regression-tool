import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './index';

describe('@vrt/engine', () => {
  it('exports its package name', () => {
    expect(PACKAGE_NAME).toBe('@vrt/engine');
  });
});
