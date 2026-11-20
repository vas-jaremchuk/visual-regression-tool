import { describe, expect, it } from 'vitest';
import { DIFF_CONTAINER_PORT, DiffContainer, diffContainerEnvVars } from './diff-container';
import * as worker from './index';

describe('DiffContainer', () => {
  it('is exported from the worker entry for the DIFF_CONTAINER binding', () => {
    expect(worker.DiffContainer).toBe(DiffContainer);
  });

  it('passes only the container variables to the container process', () => {
    const env = {
      CF_ACCOUNT_ID: 'account',
      R2_ACCESS_KEY_ID: 'key-id',
      R2_SECRET_ACCESS_KEY: 'secret',
      DIFF_CONTAINER_SHARED_SECRET: 's'.repeat(32),
      SUPABASE_SERVICE_ROLE_KEY: 'not-for-the-container',
    };
    expect(diffContainerEnvVars(env)).toEqual({
      CF_ACCOUNT_ID: 'account',
      R2_ACCESS_KEY_ID: 'key-id',
      R2_SECRET_ACCESS_KEY: 'secret',
      DIFF_CONTAINER_SHARED_SECRET: 's'.repeat(32),
      PORT: String(DIFF_CONTAINER_PORT),
    });
  });
});
