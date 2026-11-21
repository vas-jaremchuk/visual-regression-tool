import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createProjectRequest } from './contracts/web';
import { importPrototypeEnv, parseDotenv, slugify } from './env-import';

const fixture = readFileSync(
  fileURLToPath(new URL('../../../fixtures/prototype-env/example.env', import.meta.url)),
  'utf8',
);

describe('importPrototypeEnv', () => {
  it('maps the prototype .env fixture to a valid create-project request', () => {
    const result = importPrototypeEnv(fixture);
    expect(result.preview).toEqual({
      name: 'Example Site',
      slug: 'example-site',
      sitemapIndex: 'https://www.example.com/sitemap.xml',
      r2Bucket: 'someproject-visual-test',
      r2PublicUrl: 'https://pub-0123456789abcdef.r2.dev',
      basicAuthUser: 'staging',
      basicAuthPass: 's3cret#with=chars',
    });
    expect(result.ignoredKeys).toEqual([
      'CF_ACCOUNT_ID',
      'CF_API_TOKEN',
      'CHROME_PATH',
      'CHECK_CONCURRENCY',
      'UNRELATED_KEY',
    ]);
    expect(result.notes[0]).toMatch(/CF_\*/);
    expect(result.notes).toHaveLength(3);
    expect(createProjectRequest.safeParse(result.preview).success).toBe(true);
  });

  it('derives the name from the sitemap host when SITE_NAME is missing', () => {
    const { preview } = importPrototypeEnv(
      'SITEMAP_INDEX=https://www.shop.example.org/sitemap.xml\nR2_BUCKET=shop-vrt\n',
    );
    expect(preview).toMatchObject({ name: 'shop.example.org', slug: 'shop-example-org' });
  });

  it('skips empty values and comments', () => {
    const { preview, ignoredKeys } = importPrototypeEnv('# R2_BUCKET=nope\nR2_PUBLIC_URL=\n');
    expect(preview).toEqual({});
    expect(ignoredKeys).toEqual([]);
  });
});

describe('parseDotenv', () => {
  it('handles export, quotes and inline comments', () => {
    const env = parseDotenv('export A=1\nB="two # three"\nC=four # comment\nD=a#b\n');
    expect(Object.fromEntries(env)).toEqual({ A: '1', B: 'two # three', C: 'four', D: 'a#b' });
  });
});

describe('slugify', () => {
  it.each([
    ['My Site!', 'my-site'],
    ['  Ünïcode — test  ', 'unicode-test'],
    ['---', ''],
    ['x'.repeat(70), 'x'.repeat(63)],
  ])('%s → %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });
});
