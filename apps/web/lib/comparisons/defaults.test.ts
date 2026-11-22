import { describe, expect, it } from 'vitest';
import { defaultPair } from './defaults';

const runs = [{ id: 'r3' }, { id: 'r2' }, { id: 'r1' }];

describe('defaultPair', () => {
  it('compares the baseline with the latest completed run', () => {
    expect(defaultPair(runs, 'r1')).toEqual({ beforeRunId: 'r1', afterRunId: 'r3' });
  });

  it('uses the two newest runs without a usable baseline', () => {
    expect(defaultPair(runs, null)).toEqual({ beforeRunId: 'r2', afterRunId: 'r3' });
    expect(defaultPair(runs, 'r3')).toEqual({ beforeRunId: 'r2', afterRunId: 'r3' });
    expect(defaultPair(runs, 'gone')).toEqual({ beforeRunId: 'r2', afterRunId: 'r3' });
  });

  it('has no pair with fewer than two runs', () => {
    expect(defaultPair([{ id: 'r1' }], 'r1')).toBeNull();
  });
});
