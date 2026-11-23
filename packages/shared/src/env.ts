import { z } from 'zod';
import { parseEncryptionKeys } from './crypto';
import { required, sharedSecret, url } from './env-fields';
import { webPublicEnv } from './public-env';

/**
 * Environment schemas (03 §2–§4). Every app validates its env at boot with `parseEnv`, which
 * fails fast with a message naming each missing or invalid variable. Keep each app's
 * `.env.example` in sync: a unit test compares the schema keys with the example file.
 */

/** NFR-14: comma-separated hosts exempt from the SSRF guard; local development and tests only. */
const ssrfAllowHosts = z.string().trim().default('');

const encryptionKeys = (name: string) =>
  required(name).superRefine((value, ctx) => {
    try {
      parseEncryptionKeys(value);
    } catch (error) {
      ctx.addIssue({
        code: 'custom',
        message: `${name}: ${(error as Error).message} (comma-separated base64 32-byte keys)`,
      });
    }
  });

export const webEnv = z.object({
  APP_URL: url('APP_URL'),
  ...webPublicEnv.shape,
  SUPABASE_SERVICE_ROLE_KEY: required('SUPABASE_SERVICE_ROLE_KEY'),
  CF_ACCOUNT_ID: required('CF_ACCOUNT_ID'),
  CF_API_TOKEN: required('CF_API_TOKEN'),
  R2_ACCESS_KEY_ID: required('R2_ACCESS_KEY_ID'),
  R2_SECRET_ACCESS_KEY: required('R2_SECRET_ACCESS_KEY'),
  WORKER_URL: url('WORKER_URL'),
  WORKER_SHARED_SECRET: sharedSecret('WORKER_SHARED_SECRET'),
  SETTINGS_ENCRYPTION_KEY: encryptionKeys('SETTINGS_ENCRYPTION_KEY'),
  RESEND_API_KEY: required('RESEND_API_KEY'),
  EMAIL_FROM: required('EMAIL_FROM'),
  // `mailpit` delivers app emails (invitations) to the local Supabase mail catcher instead of
  // Resend; local development and e2e only.
  EMAIL_TRANSPORT: z
    .enum(['resend', 'mailpit'], { error: 'EMAIL_TRANSPORT must be resend or mailpit' })
    .default('resend'),
  MAILPIT_URL: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.url({ error: 'MAILPIT_URL must be an absolute URL' }).optional(),
  ),
  // Temporary: deliver every app email to this one address (e.g. while the Resend domain is not
  // verified, Resend only sends to the account owner). The real recipient is kept in the subject.
  EMAIL_REDIRECT_TO: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.email({ error: 'EMAIL_REDIRECT_TO must be an email address' }).optional(),
  ),
  // Shows the Google button on /login; the provider itself is configured in Supabase Auth (04 §1).
  GOOGLE_AUTH_ENABLED: z
    .stringbool({ error: 'GOOGLE_AUTH_ENABLED must be true or false' })
    .default(false),
  SSRF_ALLOW_HOSTS: ssrfAllowHosts,
});
export type WebEnv = z.infer<typeof webEnv>;

export const workerEnv = z.object({
  SUPABASE_URL: url('SUPABASE_URL'),
  SUPABASE_SERVICE_ROLE_KEY: required('SUPABASE_SERVICE_ROLE_KEY'),
  CF_ACCOUNT_ID: required('CF_ACCOUNT_ID'),
  CF_API_TOKEN: required('CF_API_TOKEN'),
  R2_ACCESS_KEY_ID: required('R2_ACCESS_KEY_ID'),
  R2_SECRET_ACCESS_KEY: required('R2_SECRET_ACCESS_KEY'),
  WORKER_SHARED_SECRET: sharedSecret('WORKER_SHARED_SECRET'),
  SETTINGS_ENCRYPTION_KEY: encryptionKeys('SETTINGS_ENCRYPTION_KEY'),
  RESEND_API_KEY: required('RESEND_API_KEY'),
  EMAIL_FROM: required('EMAIL_FROM'),
  APP_URL: url('APP_URL'),
  DIFF_CONTAINER_SHARED_SECRET: sharedSecret('DIFF_CONTAINER_SHARED_SECRET'),
  SSRF_ALLOW_HOSTS: ssrfAllowHosts,
});
export type WorkerEnv = z.infer<typeof workerEnv>;

/** The diff container only reads/writes R2 and authenticates the worker (06 §6). */
export const containerEnv = z.object({
  CF_ACCOUNT_ID: required('CF_ACCOUNT_ID'),
  R2_ACCESS_KEY_ID: required('R2_ACCESS_KEY_ID'),
  R2_SECRET_ACCESS_KEY: required('R2_SECRET_ACCESS_KEY'),
  DIFF_CONTAINER_SHARED_SECRET: sharedSecret('DIFF_CONTAINER_SHARED_SECRET'),
  PORT: z.coerce
    .number({ error: 'PORT must be a number' })
    .int('PORT must be an integer')
    .min(1, 'PORT must be between 1 and 65535')
    .max(65535, 'PORT must be between 1 and 65535')
    .default(8080),
});
export type ContainerEnv = z.infer<typeof containerEnv>;

/** Staging fixture site Worker (`apps/worker/wrangler.fixture-site.jsonc`, 11 §4): `v1` or `v2`. */
export const fixtureSiteEnv = z.object({
  SITE_VERSION: z.enum(['v1', 'v2'], { error: 'SITE_VERSION must be v1 or v2' }).default('v1'),
});
export type FixtureSiteEnv = z.infer<typeof fixtureSiteEnv>;

/** Playwright staging suite (`apps/web/e2e-staging`, 11 §4); never production. */
export const stagingEnv = z.object({
  STAGING_APP_URL: url('STAGING_APP_URL'),
  STAGING_SUPABASE_URL: url('STAGING_SUPABASE_URL'),
  STAGING_SUPABASE_SERVICE_ROLE_KEY: required('STAGING_SUPABASE_SERVICE_ROLE_KEY'),
  STAGING_FIXTURE_SITE_URL: url('STAGING_FIXTURE_SITE_URL'),
  STAGING_ADMIN_EMAIL: required('STAGING_ADMIN_EMAIL').pipe(z.email()),
  STAGING_SLACK_WEBHOOK_URL: url('STAGING_SLACK_WEBHOOK_URL'),
  STAGING_LEGACY_ENV: required('STAGING_LEGACY_ENV'),
});
export type StagingEnv = z.infer<typeof stagingEnv>;
