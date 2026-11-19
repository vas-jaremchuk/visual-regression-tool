import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { toBase64 } from './encoding';
import { EnvValidationError, containerEnv, parseEnv, webEnv, workerEnv } from './env';

function exampleKeys(app: string): string[] {
  const file = fileURLToPath(new URL(`../../../apps/${app}/.env.example`, import.meta.url));
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => /^([A-Z][A-Z0-9_]*)=/.exec(line.trim())?.[1])
    .filter((key): key is string => Boolean(key));
}

const encryptionKey = toBase64(new Uint8Array(32).fill(7));
const secret = 'x'.repeat(32);

const validWeb = {
  APP_URL: 'https://vrt.example.com',
  NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  CF_ACCOUNT_ID: 'acct',
  CF_API_TOKEN: 'token',
  R2_ACCESS_KEY_ID: 'id',
  R2_SECRET_ACCESS_KEY: 'key',
  WORKER_URL: 'https://vrt-worker.example.workers.dev',
  WORKER_SHARED_SECRET: secret,
  SETTINGS_ENCRYPTION_KEY: encryptionKey,
  RESEND_API_KEY: 're_123',
  EMAIL_FROM: 'Visual Regression <vrt@example.com>',
};

const validWorker = {
  SUPABASE_URL: 'https://abc.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  CF_ACCOUNT_ID: 'acct',
  CF_API_TOKEN: 'token',
  R2_ACCESS_KEY_ID: 'id',
  R2_SECRET_ACCESS_KEY: 'key',
  WORKER_SHARED_SECRET: secret,
  SETTINGS_ENCRYPTION_KEY: `${encryptionKey},${encryptionKey}`,
  RESEND_API_KEY: 're_123',
  EMAIL_FROM: 'vrt@example.com',
  APP_URL: 'https://vrt.example.com',
  DIFF_CONTAINER_SHARED_SECRET: secret,
};

describe('.env.example files match the schemas', () => {
  const cases: [string, z.ZodObject][] = [
    ['web', webEnv],
    ['worker', workerEnv],
    ['diff-container', containerEnv],
  ];
  it.each(cases)('apps/%s', (app, schema) => {
    expect(exampleKeys(app).sort()).toEqual(Object.keys(schema.shape).sort());
  });
});

describe('parseEnv', () => {
  it('accepts a valid web env and drops unknown keys', () => {
    const env = parseEnv(webEnv, { ...validWeb, PATH: '/usr/bin' }, 'web');
    expect(env.APP_URL).toBe('https://vrt.example.com');
    expect(env).not.toHaveProperty('PATH');
  });

  it('accepts a worker env with bindings mixed in', () => {
    const env = parseEnv(workerEnv, { ...validWorker, BROWSER: {}, CAPTURE_QUEUE: {} }, 'worker');
    expect(env.DIFF_CONTAINER_SHARED_SECRET).toBe(secret);
  });

  it('defaults and coerces the container port', () => {
    const base = {
      CF_ACCOUNT_ID: 'acct',
      R2_ACCESS_KEY_ID: 'id',
      R2_SECRET_ACCESS_KEY: 'key',
      DIFF_CONTAINER_SHARED_SECRET: secret,
    };
    expect(parseEnv(containerEnv, base, 'container').PORT).toBe(8080);
    expect(parseEnv(containerEnv, { ...base, PORT: '9000' }, 'container').PORT).toBe(9000);
    expect(() => parseEnv(containerEnv, { ...base, PORT: 'abc' }, 'container')).toThrow(/PORT/);
  });

  it('names every missing or invalid variable', () => {
    const rest: Partial<typeof validWeb> = { ...validWeb };
    delete rest.RESEND_API_KEY;
    let error: unknown;
    try {
      parseEnv(
        webEnv,
        {
          ...rest,
          APP_URL: 'not a url',
          WORKER_SHARED_SECRET: 'short',
          SETTINGS_ENCRYPTION_KEY: toBase64(new Uint8Array(16)),
          CF_API_TOKEN: '  ',
        },
        'web',
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(EnvValidationError);
    const envError = error as EnvValidationError;
    expect(envError.variables.sort()).toEqual(
      [
        'APP_URL',
        'CF_API_TOKEN',
        'RESEND_API_KEY',
        'SETTINGS_ENCRYPTION_KEY',
        'WORKER_SHARED_SECRET',
      ].sort(),
    );
    expect(envError.message).toContain('Invalid web environment');
    expect(envError.message).toContain('RESEND_API_KEY: RESEND_API_KEY is required');
    expect(envError.message).toContain('APP_URL: APP_URL must be an absolute URL');
    expect(envError.message).toContain('key #1 must decode to 32 bytes');
    expect(envError.message).not.toContain(secret);
  });
});
