import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * NFR-13: modules that read server secrets (server env, the service role client, the worker HMAC
 * client) start with `import 'server-only'`, so a client component importing them fails the
 * build, and client components never import them directly. `check:bundle` in CI greps the built
 * bundle for the service role key on top of this.
 */

const WEB = fileURLToPath(new URL('..', import.meta.url));

/** Imports of modules that hold secrets. */
const SECRET_IMPORT =
  /from ['"](?:@\/lib\/|(?:\.\.?\/)+(?:lib\/)?)(?:env|supabase\/admin|worker-client)['"]/;
/** Direct reads of server-only environment variables. */
const SECRET_ENV = /process\.env\.(?!NEXT_PUBLIC_|NODE_ENV\b)[A-Z_]+|SUPABASE_SERVICE_ROLE_KEY/;

function* sources(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sources(path);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) yield path;
  }
}

const files = ['lib', 'components', 'app'].flatMap((dir) =>
  [...sources(join(WEB, dir))].map((path) => ({
    path: relative(WEB, path),
    source: readFileSync(path, 'utf8'),
  })),
);

const isClient = (source: string) => /^\s*['"]use client['"]/.test(source);
const isServerOnly = (source: string) => /^import ['"]server-only['"];?$/m.test(source);
const touchesSecrets = (source: string) => SECRET_IMPORT.test(source) || SECRET_ENV.test(source);

describe('server-only audit (NFR-13)', () => {
  it('finds the secret-holding modules', () => {
    const paths = files.map((f) => f.path);
    expect(paths).toEqual(
      expect.arrayContaining(['lib/env.ts', 'lib/supabase/admin.ts', 'lib/worker-client.ts']),
    );
  });

  it.each(['lib/env.ts', 'lib/supabase/admin.ts', 'lib/worker-client.ts'])(
    '%s starts with server-only',
    (path) => {
      expect(isServerOnly(files.find((f) => f.path === path)!.source)).toBe(true);
    },
  );

  it('every lib and components module that touches secrets imports server-only', () => {
    const missing = files
      .filter((f) => !f.path.startsWith('app/'))
      .filter((f) => touchesSecrets(f.source) && !isServerOnly(f.source))
      .map((f) => f.path);
    expect(missing).toEqual([]);
  });

  it('no client component touches secrets', () => {
    const leaks = files
      .filter((f) => isClient(f.source) && touchesSecrets(f.source))
      .map((f) => f.path);
    expect(leaks).toEqual([]);
  });

  it('no client component imports a server-only module', () => {
    const serverOnly = files
      .filter((f) => !f.path.startsWith('app/') && isServerOnly(f.source))
      .map((f) => f.path.replace(/\.tsx?$/, ''));
    const leaks = files
      .filter((f) => isClient(f.source))
      .flatMap((f) =>
        // `import type` is erased at build time and is fine.
        [...f.source.matchAll(/^import (?!type )[^;]*?from ['"]@\/([^'"]+)['"]/gm)]
          .map((m) => m[1]!.replace(/\/index$/, ''))
          .filter((target) => serverOnly.includes(target))
          .map((target) => `${f.path} -> ${target}`),
      );
    expect(leaks).toEqual([]);
  });
});
