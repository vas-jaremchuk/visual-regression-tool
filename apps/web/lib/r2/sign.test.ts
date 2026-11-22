import { describe, expect, it } from 'vitest';
import { RequestError } from '../members/errors';
import {
  signComparisonObject,
  signSharedObject,
  type SharedSignGateway,
  type SignComparison,
  type SignGateway,
} from './sign';

const BEFORE = '2026-11-01_10-00-00';
const AFTER = '2026-11-02_10-00-00';

const comparisonA: SignComparison = {
  id: 'cmp-a',
  projectId: 'project-a',
  label: `${BEFORE}_vs_${AFTER}`,
  beforeLabel: BEFORE,
  afterLabel: AFTER,
  bucket: 'vrt-a',
};

function gateway(options: { visible?: boolean; role?: boolean } = {}) {
  const signed: { bucket: string; key: string; ttl: number }[] = [];
  const g: SignGateway = {
    async loadComparison(id) {
      return options.visible === false || id !== comparisonA.id ? null : comparisonA;
    },
    async assertCan(action) {
      if (options.role === false) throw new RequestError(403, 'forbidden', action);
    },
    async presignGet(bucket, key, ttl) {
      signed.push({ bucket, key, ttl });
      return `https://r2.test/${bucket}/${key}?sig=1`;
    },
  };
  return { g, signed };
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

describe('signComparisonObject', () => {
  it.each([
    `screenshots/${BEFORE}/desktop/home.png`,
    `screenshots/${AFTER}/mobile/about.png`,
    `screenshots/${AFTER}/_files/doc.pdf.txt`,
    `diffs/${BEFORE}_vs_${AFTER}/desktop/home.png`,
    `reports/${BEFORE}_vs_${AFTER}/index.html`,
  ])('signs %s in the comparison project bucket for 1 h', async (key) => {
    const { g, signed } = gateway();
    const result = await signComparisonObject(g, { comparisonId: 'cmp-a', key }, () => 0);
    expect(result).toEqual({
      url: `https://r2.test/vrt-a/${key}?sig=1`,
      expiresAt: new Date(3_600_000).toISOString(),
    });
    expect(signed).toEqual([{ bucket: 'vrt-a', key, ttl: 3600 }]);
  });

  it.each([
    // a run of another project (or of another comparison of this one)
    'screenshots/2026-10-01_10-00-00/desktop/home.png',
    'diffs/2026-10-01_10-00-00_vs_2026-11-02_10-00-00/desktop/home.png',
    // prefix escapes and odd shapes
    `screenshots/${AFTER}/../2026-10-01_10-00-00/desktop/home.png`,
    `screenshots/${AFTER}//home.png`,
    `screenshots/${AFTER}/`,
    `screenshots/${AFTER}\\home.png`,
    '_vrt/probe.txt',
    '',
  ])('refuses %j with 403 and signs nothing', async (key) => {
    const { g, signed } = gateway();
    const error = await rejection(signComparisonObject(g, { comparisonId: 'cmp-a', key }));
    expect(error).toBeInstanceOf(RequestError);
    expect((error as RequestError).status).toBe(403);
    expect(signed).toEqual([]);
  });

  it('returns 404 for a comparison the user cannot see (another project)', async () => {
    const { g, signed } = gateway({ visible: false });
    const error = await rejection(
      signComparisonObject(g, {
        comparisonId: 'cmp-a',
        key: `screenshots/${BEFORE}/desktop/home.png`,
      }),
    );
    expect((error as RequestError).status).toBe(404);
    expect(signed).toEqual([]);
  });

  it('refuses users without the view permission', async () => {
    const { g, signed } = gateway({ role: false });
    const error = await rejection(
      signComparisonObject(g, {
        comparisonId: 'cmp-a',
        key: `screenshots/${BEFORE}/desktop/home.png`,
      }),
    );
    expect((error as RequestError).status).toBe(403);
    expect(signed).toEqual([]);
  });
});

describe('signSharedObject', () => {
  const TOKEN = 'a'.repeat(43);
  const KEY = `diffs/${BEFORE}_vs_${AFTER}/desktop/home.png`;

  function shared(live = true) {
    const signed: string[] = [];
    const resolved: string[] = [];
    const g: SharedSignGateway = {
      async resolveShareToken(token) {
        resolved.push(token);
        return live && token === TOKEN ? comparisonA.id : null;
      },
      async loadComparison(id) {
        return id === comparisonA.id ? comparisonA : null;
      },
      async presignGet(bucket, key) {
        signed.push(`${bucket}/${key}`);
        return `https://r2.test/${bucket}/${key}?sig=1`;
      },
    };
    return { g, signed, resolved };
  }

  it('signs an object of the shared comparison', async () => {
    const { g, signed } = shared();
    const result = await signSharedObject(g, { token: TOKEN, comparisonId: 'cmp-a', key: KEY });
    expect(result.url).toBe(`https://r2.test/vrt-a/${KEY}?sig=1`);
    expect(signed).toEqual([`vrt-a/${KEY}`]);
  });

  it('answers 404 for a revoked or expired token', async () => {
    const { g, signed } = shared(false);
    const error = await rejection(signSharedObject(g, { token: TOKEN, key: KEY }));
    expect((error as RequestError).status).toBe(404);
    expect(signed).toEqual([]);
  });

  it('answers 404 without a lookup for a malformed token', async () => {
    const { g, resolved } = shared();
    const error = await rejection(signSharedObject(g, { token: 'nope', key: KEY }));
    expect((error as RequestError).status).toBe(404);
    expect(resolved).toEqual([]);
  });

  it('answers 404 when the comparison is not the one the token was made for', async () => {
    const { g, signed } = shared();
    const error = await rejection(
      signSharedObject(g, { token: TOKEN, comparisonId: 'cmp-b', key: KEY }),
    );
    expect((error as RequestError).status).toBe(404);
    expect(signed).toEqual([]);
  });

  it('refuses keys outside the shared comparison', async () => {
    const { g, signed } = shared();
    const error = await rejection(
      signSharedObject(g, {
        token: TOKEN,
        key: 'screenshots/2026-10-01_10-00-00/desktop/home.png',
      }),
    );
    expect((error as RequestError).status).toBe(403);
    expect(signed).toEqual([]);
  });
});
