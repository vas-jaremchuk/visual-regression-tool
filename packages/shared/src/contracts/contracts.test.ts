import { describe, expect, it } from 'vitest';
import { PROJECT_DEFAULTS, PROJECT_LIMITS } from '../constants';
import {
  apiErrorResponse,
  captureMsg,
  createInvitationRequest,
  createProjectRequest,
  deleteJob,
  diffMsg,
  diffRequest,
  diffResponse,
  importLegacyRequest,
  projectSettingsSchema,
  reviewRequest,
  startRunRequest,
  startRunResponse,
  viewportSchema,
} from './index';

const uuid = '0b3a9c1e-5f4d-4c2b-9a8e-1d2c3b4a5f60';
const minimalSettings = {
  name: 'Stagen',
  slug: 'stagen',
  sitemapIndex: 'https://example.com/sitemap_index.xml',
  r2Bucket: 'stagen-vrt',
};

describe('projectSettingsSchema', () => {
  it('fills defaults from 02 §2', () => {
    const settings = projectSettingsSchema.parse(minimalSettings);
    expect(settings).toMatchObject({
      ...PROJECT_DEFAULTS,
      r2PublicUrl: null,
      basicAuthUser: null,
      hideSelectors: [],
      fileExtensions: null,
      extraCss: null,
    });
  });

  it.each([
    ['captureConcurrency', PROJECT_LIMITS.captureConcurrency],
    ['settleMs', PROJECT_LIMITS.settleMs],
    ['pageTimeoutMs', PROJECT_LIMITS.pageTimeoutMs],
    ['maxPageHeight', PROJECT_LIMITS.maxPageHeight],
    ['diffThreshold', PROJECT_LIMITS.diffThreshold],
    ['changeThresholdPct', PROJECT_LIMITS.changeThresholdPct],
  ] as const)('enforces min/max for %s', (field, { min, max }) => {
    const parse = (value: number) =>
      projectSettingsSchema.safeParse({ ...minimalSettings, [field]: value }).success;
    expect(parse(min)).toBe(true);
    expect(parse(max)).toBe(true);
    expect(parse(min - 1)).toBe(false);
    expect(parse(max + 1)).toBe(false);
  });

  it('validates bucket names, URLs and extensions', () => {
    const parse = (patch: object) =>
      projectSettingsSchema.safeParse({ ...minimalSettings, ...patch }).success;
    expect(parse({ r2Bucket: 'ab' })).toBe(false);
    expect(parse({ r2Bucket: 'Upper-Case' })).toBe(false);
    expect(parse({ r2Bucket: 'a'.repeat(64) })).toBe(false);
    expect(parse({ sitemapIndex: 'ftp://example.com/sitemap.xml' })).toBe(false);
    expect(parse({ captureConcurrency: 1.5 })).toBe(false);
    expect(
      projectSettingsSchema.parse({ ...minimalSettings, fileExtensions: ['PDF'] }),
    ).toMatchObject({ fileExtensions: ['pdf'] });
    expect(parse({ fileExtensions: ['.pdf'] })).toBe(false);
  });

  it('create request accepts a write-only password and an optional slug', () => {
    const withoutSlug: Partial<typeof minimalSettings> = { ...minimalSettings };
    delete withoutSlug.slug;
    expect(createProjectRequest.parse({ ...withoutSlug, basicAuthPass: 'pw' })).toMatchObject({
      basicAuthPass: 'pw',
    });
  });
});

describe('viewportSchema', () => {
  it('accepts presets and rejects bad slugs and sizes', () => {
    expect(
      viewportSchema.parse({ slug: 'mobile', width: 390, height: 844, isMobile: true }),
    ).toMatchObject({ deviceScaleFactor: 1, enabled: true });
    expect(viewportSchema.safeParse({ slug: 'Mobile', width: 390, height: 844 }).success).toBe(
      false,
    );
    expect(viewportSchema.safeParse({ slug: 'm', width: 10, height: 844 }).success).toBe(false);
  });
});

describe('web contracts', () => {
  const run = { snapshotId: uuid, viewports: ['desktop'] };

  it('start run requires urls for custom scope and sample for sample scope', () => {
    expect(startRunRequest.parse(run)).toMatchObject({ scope: 'all', dryRun: false });
    expect(startRunRequest.safeParse({ ...run, scope: 'custom' }).success).toBe(false);
    expect(
      startRunRequest.safeParse({ ...run, scope: 'custom', urls: ['https://example.com/'] })
        .success,
    ).toBe(true);
    expect(startRunRequest.safeParse({ ...run, scope: 'sample' }).success).toBe(false);
    expect(startRunRequest.safeParse({ ...run, scope: 'sample', sample: 20 }).success).toBe(true);
    expect(startRunRequest.safeParse({ ...run, viewports: [] }).success).toBe(false);
  });

  it('start run response covers real and dry runs', () => {
    expect(
      startRunResponse.parse({ dryRun: false, runId: uuid, label: '2026-08-07_10-00-00' }),
    ).toBeTruthy();
    expect(
      startRunResponse.parse({
        dryRun: true,
        items: [
          {
            url: 'https://example.com/',
            kind: 'page',
            viewportSlug: 'desktop',
            filename: 'index.png',
          },
        ],
      }),
    ).toBeTruthy();
  });

  it('review, invitation and legacy import bodies', () => {
    expect(reviewRequest.safeParse({ itemIds: [uuid], review: 'approved' }).success).toBe(true);
    expect(reviewRequest.safeParse({ itemIds: [], review: 'approved' }).success).toBe(false);
    expect(reviewRequest.safeParse({ itemIds: [uuid], review: 'maybe' }).success).toBe(false);
    expect(createInvitationRequest.parse({ email: 'Ann@Example.com' })).toEqual({
      email: 'ann@example.com',
      projectId: null,
      role: 'viewer',
    });
    expect(importLegacyRequest.safeParse({ action: 'list' }).success).toBe(true);
    expect(
      importLegacyRequest.safeParse({ action: 'import', labels: ['2026-08-07_10-00-00'] }).success,
    ).toBe(true);
    expect(importLegacyRequest.safeParse({ action: 'import', labels: ['x'] }).success).toBe(false);
  });

  it('error body', () => {
    expect(
      apiErrorResponse.safeParse({ error: { code: 'conflict', message: 'Run already active' } })
        .success,
    ).toBe(true);
  });
});

describe('worker, queue and container contracts', () => {
  it('worker job bodies carry ids only', () => {
    expect(deleteJob.safeParse({ entity: 'run', id: uuid }).success).toBe(true);
    expect(deleteJob.safeParse({ entity: 'bucket', id: uuid }).success).toBe(false);
  });

  it('queue messages are versioned', () => {
    expect(captureMsg.safeParse({ v: 1, runId: uuid, itemIds: [uuid] }).success).toBe(true);
    expect(captureMsg.safeParse({ v: 2, runId: uuid, itemIds: [uuid] }).success).toBe(false);
    expect(diffMsg.safeParse({ v: 1, comparisonId: uuid, itemIds: [uuid] }).success).toBe(true);
  });

  it('container /diff request and response from 09 §4', () => {
    const request = diffRequest.parse({
      bucket: 'b',
      beforeKey: 'screenshots/a/desktop/index.png',
      afterKey: 'screenshots/b/desktop/index.png',
      diffKey: 'diffs/a_vs_b/desktop/index.png',
      threshold: 0.1,
      changeThresholdPct: 0.05,
      regions: [{ x: 0, y: 0, width: 1280, height: 80 }],
    });
    expect(request.regions).toHaveLength(1);
    expect(request.maxPageHeight).toBe(16_384);
    expect(diffRequest.safeParse({ ...request, threshold: 2 }).success).toBe(false);
    expect(diffRequest.safeParse({ ...request, maxPageHeight: 40_000 }).success).toBe(false);
    expect(
      diffResponse.safeParse({
        changed: true,
        diffPct: 1.23,
        diffPixels: 12345,
        totalPixels: 1000000,
        beforeDims: [1280, 5000],
        afterDims: [1280, 5100],
        afterSha256: 'a'.repeat(64),
      }).success,
    ).toBe(true);
  });
});
