import { describe, expect, it } from 'vitest';
import { acquireLease, releaseLease } from './leases';

describe('leases', () => {
  it('grants up to the limit, then refuses', () => {
    let leases = acquireLease({}, 'a', 2, 1000, 0)!;
    leases = acquireLease(leases, 'b', 2, 1000, 0)!;
    expect(Object.keys(leases)).toEqual(['a', 'b']);
    expect(acquireLease(leases, 'c', 2, 1000, 0)).toBeNull();
  });

  it('frees a slot on release', () => {
    const leases = acquireLease(acquireLease({}, 'a', 1, 1000, 0)!, 'a', 1, 1000, 0)!;
    expect(acquireLease(leases, 'b', 1, 1000, 10)).toBeNull();
    expect(acquireLease(releaseLease(leases, 'a', 10), 'b', 1, 1000, 10)).toEqual({ b: 1010 });
  });

  it('expires leases that were never released', () => {
    const leases = acquireLease({}, 'crashed', 1, 1000, 0)!;
    expect(acquireLease(leases, 'b', 1, 1000, 999)).toBeNull();
    expect(acquireLease(leases, 'b', 1, 1000, 1000)).toEqual({ b: 2000 });
  });

  it('renews a lease its holder already has', () => {
    expect(acquireLease({ a: 500 }, 'a', 1, 1000, 100)).toEqual({ a: 1100 });
  });
});
