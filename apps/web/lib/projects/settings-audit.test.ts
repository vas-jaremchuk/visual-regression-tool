import { describe, expect, it } from 'vitest';
import { REDACTED, redactSecrets, settingsChanges } from './settings-audit';

describe('settingsChanges', () => {
  it('lists only changed fields with old and new values', () => {
    expect(
      settingsChanges(
        { name: 'Old', settleMs: 3000, hideSelectors: ['.a'] },
        { name: 'New', settleMs: 3000, hideSelectors: ['.a', '.b'] },
      ),
    ).toEqual({
      name: { old: 'Old', new: 'New' },
      hideSelectors: { old: ['.a'], new: ['.a', '.b'] },
    });
  });

  it('never records secret values', () => {
    const changes = settingsChanges({ basicAuthPass: 'set' }, { basicAuthPass: 'hunter2' });
    expect(changes).toEqual({ basicAuthPass: { old: REDACTED, new: REDACTED } });
    expect(JSON.stringify(changes)).not.toContain('hunter2');
    expect(settingsChanges({ basicAuthPass: null }, { basicAuthPass: 'x' })).toEqual({
      basicAuthPass: { old: null, new: REDACTED },
    });
    expect(settingsChanges({ basicAuthPass: 'set' }, { basicAuthPass: null })).toEqual({
      basicAuthPass: { old: REDACTED, new: null },
    });
  });
});

describe('redactSecrets', () => {
  it('replaces secrets and drops undefined values', () => {
    expect(redactSecrets({ name: 'A', basicAuthPass: 'hunter2', slug: undefined })).toEqual({
      name: 'A',
      basicAuthPass: REDACTED,
    });
  });
});
