import { describe, expect, it } from 'vitest';
import { basicAuthHeader, errorReason } from './util';

describe('util', () => {
  it('builds a UTF-8 safe basic auth header', () => {
    expect(basicAuthHeader('user', 'pass')).toBe('Basic dXNlcjpwYXNz');
    expect(basicAuthHeader('ü', 'p')).toBe('Basic ' + Buffer.from('ü:p').toString('base64'));
  });

  it('prefers error codes, then cause codes, then messages', () => {
    expect(errorReason(Object.assign(new Error('m'), { code: 'EX' }))).toBe('EX');
    expect(errorReason(Object.assign(new Error('m'), { cause: { code: 'EY' } }))).toBe('EY');
    expect(errorReason(new Error('m'))).toBe('m');
    expect(errorReason({})).toBe('[object Object]');
    expect(errorReason(null)).toBe('null');
  });
});
