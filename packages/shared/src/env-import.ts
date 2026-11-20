import type { ImportEnvResponse } from './contracts/web';

/**
 * Prototype `.env` → project preview (F-PROJ-4, 03 §1). Pure: the caller shows the preview and
 * creates the project with `createProjectRequest`. Values are not validated here; the create form
 * validates them like any other input.
 */

/** Prototype keys that become project fields. */
const FIELD_KEYS = {
  SITE_NAME: 'name',
  SITEMAP_INDEX: 'sitemapIndex',
  R2_BUCKET: 'r2Bucket',
  R2_PUBLIC_URL: 'r2PublicUrl',
  BASIC_AUTH_USER: 'basicAuthUser',
  BASIC_AUTH_PASS: 'basicAuthPass',
} as const;

/** Prototype keys with no per-project home, and why (03 §1). */
const PLATFORM_KEYS: Record<string, string> = {
  CHROME_PATH: 'CHROME_PATH is not needed: pages are captured with Browser Rendering.',
  CHECK_CONCURRENCY:
    'CHECK_CONCURRENCY is ignored: redirect checks always use 8 parallel requests.',
};

const CF_NOTE = 'Cloudflare credentials (CF_*) are platform settings and were ignored.';

/** Lowercase dash-separated slug (`projectSlug`), e.g. `My Site!` → `my-site`. */
export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/, '');
}

/** One dotenv value: quotes stripped, `#` after whitespace starts a comment when unquoted. */
function parseValue(raw: string): string {
  const value = raw.trim();
  const quote = value[0];
  if (quote === '"' || quote === "'") {
    const end = value.indexOf(quote, 1);
    if (end > 0) {
      const inner = value.slice(1, end);
      return quote === '"' ? inner.replace(/\\n/g, '\n').replace(/\\(["\\])/g, '$1') : inner;
    }
  }
  return value.replace(/\s+#.*$/, '').trim();
}

/** `KEY=value` pairs in file order; later keys win, like dotenv. */
export function parseDotenv(text: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (match) entries.set(match[1]!, parseValue(match[2]!));
  }
  return entries;
}

function hostname(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, '') || undefined;
  } catch {
    return undefined;
  }
}

export function importPrototypeEnv(text: string): ImportEnvResponse {
  const preview: ImportEnvResponse['preview'] = {};
  const ignoredKeys: string[] = [];
  const notes: string[] = [];
  let sawCloudflare = false;

  for (const [key, value] of parseDotenv(text)) {
    if (key in FIELD_KEYS) {
      if (value !== '') preview[FIELD_KEYS[key as keyof typeof FIELD_KEYS]] = value;
    } else if (key.startsWith('CF_')) {
      ignoredKeys.push(key);
      sawCloudflare = true;
    } else {
      ignoredKeys.push(key);
      const note = PLATFORM_KEYS[key];
      if (note) notes.push(note);
    }
  }
  if (sawCloudflare) notes.unshift(CF_NOTE);

  preview.name ??= hostname(preview.sitemapIndex);
  if (preview.name) {
    const slug = slugify(preview.name);
    if (slug) preview.slug = slug;
  }
  return { preview, ignoredKeys, notes };
}
