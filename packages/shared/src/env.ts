import { z } from 'zod';
import { parseEncryptionKeys } from './crypto';

/**
 * Environment schemas (03 §2–§4). Every app validates its env at boot with `parseEnv`, which
 * fails fast with a message naming each missing or invalid variable. Keep each app's
 * `.env.example` in sync: a unit test compares the schema keys with the example file.
 */

const required = (name: string) =>
  z
    .string({ error: `${name} is required` })
    .trim()
    .min(1, `${name} is required`);

const url = (name: string) =>
  required(name).pipe(z.url({ error: `${name} must be an absolute URL` }));

const sharedSecret = (name: string) =>
  required(name).pipe(z.string().min(32, `${name} must be at least 32 characters`));

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
  NEXT_PUBLIC_SUPABASE_URL: url('NEXT_PUBLIC_SUPABASE_URL'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: required('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
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
  // Shows the Google button on /login; the provider itself is configured in Supabase Auth (04 §1).
  GOOGLE_AUTH_ENABLED: z
    .stringbool({ error: 'GOOGLE_AUTH_ENABLED must be true or false' })
    .default(false),
  SSRF_ALLOW_HOSTS: ssrfAllowHosts,
});
export type WebEnv = z.infer<typeof webEnv>;

/** The subset of `webEnv` the browser bundle may see. */
export const webPublicEnv = webEnv.pick({
  NEXT_PUBLIC_SUPABASE_URL: true,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: true,
});
export type WebPublicEnv = z.infer<typeof webPublicEnv>;

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

export class EnvValidationError extends Error {
  readonly variables: string[];

  constructor(app: string, issues: { variable: string; message: string }[]) {
    super(
      `Invalid ${app} environment:\n` +
        issues.map((issue) => `  - ${issue.variable}: ${issue.message}`).join('\n'),
    );
    this.name = 'EnvValidationError';
    this.variables = [...new Set(issues.map((issue) => issue.variable))];
  }
}

/**
 * Validates `source` (e.g. `process.env` or a Worker `env`) against `schema`. Unknown keys
 * (other variables, Worker bindings) are ignored and not returned.
 */
export function parseEnv<T extends z.ZodObject>(
  schema: T,
  source: Record<string, unknown>,
  app: string,
): z.infer<T> {
  const result = schema.safeParse(source);
  if (result.success) return result.data;
  throw new EnvValidationError(
    app,
    result.error.issues.map((issue) => ({
      variable: String(issue.path[0] ?? '(root)'),
      message: issue.message,
    })),
  );
}
