import { z } from 'zod';

/**
 * Field builders and `parseEnv` for the env schemas (03 §2–§4). Kept apart from the server
 * schemas in `env.ts` so the browser bundle, which only needs `webPublicEnv`, never includes the
 * names of server secrets (NFR-13, `check:bundle`).
 */

export const required = (name: string) =>
  z
    .string({ error: `${name} is required` })
    .trim()
    .min(1, `${name} is required`);

export const url = (name: string) =>
  required(name).pipe(z.url({ error: `${name} must be an absolute URL` }));

export const sharedSecret = (name: string) =>
  required(name).pipe(z.string().min(32, `${name} must be at least 32 characters`));

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
