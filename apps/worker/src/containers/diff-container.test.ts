import { parseEnv, toBase64, workerEnv } from '@vrt/shared';
import { describe, expect, it } from 'vitest';
import { DIFF_CONTAINER_PORT, DiffContainer, diffContainerEnvVars } from './diff-container';
import * as worker from '../index';

const config = parseEnv(
  workerEnv,
  {
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    CF_ACCOUNT_ID: 'account',
    CF_API_TOKEN: 'api-token',
    R2_ACCESS_KEY_ID: 'key-id',
    R2_SECRET_ACCESS_KEY: 'secret',
    WORKER_SHARED_SECRET: 'w'.repeat(32),
    SETTINGS_ENCRYPTION_KEY: toBase64(new Uint8Array(32).fill(1)),
    RESEND_API_KEY: 'resend',
    EMAIL_FROM: 'vrt@example.com',
    APP_URL: 'https://vrt.example.com',
    DIFF_CONTAINER_SHARED_SECRET: 'd'.repeat(32),
  },
  'worker',
);

describe('DiffContainer', () => {
  it('is exported from the worker entry for the DIFF_CONTAINER binding', () => {
    expect(worker.DiffContainer).toBe(DiffContainer);
  });

  it('forwards only the R2 credentials and bearer secret to the container', () => {
    expect(diffContainerEnvVars(config)).toEqual({
      CF_ACCOUNT_ID: 'account',
      R2_ACCESS_KEY_ID: 'key-id',
      R2_SECRET_ACCESS_KEY: 'secret',
      DIFF_CONTAINER_SHARED_SECRET: 'd'.repeat(32),
      PORT: String(DIFF_CONTAINER_PORT),
    });
  });
});
