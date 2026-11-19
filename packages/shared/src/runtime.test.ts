import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { describe, expect, it } from 'vitest';

/**
 * Proves the package runs without Node APIs: bundle it for a neutral platform and execute it in
 * workerd (the Workers runtime, also the model for Next.js edge) with Node globals disabled.
 */

const entry = `
import * as shared from './index';

export default {
  async fetch() {
    const key = shared.toBase64(crypto.getRandomValues(new Uint8Array(32)));
    const rotated = shared.toBase64(crypto.getRandomValues(new Uint8Array(32)));
    const payload = await shared.encryptSecret('hunter2', key);
    const roundTrip = await shared.decryptSecret(payload, rotated + ',' + key);

    const req = { secret: 'x'.repeat(32), method: 'POST', path: '/jobs/capture', body: '{}' };
    const header = await shared.signRequest(req);
    const valid = await shared.verifyRequest({ ...req, header });
    const wrongBody = await shared.verifyRequest({ ...req, header, body: '{"a":1}' });

    return Response.json({
      roundTrip,
      valid: valid.ok,
      wrongBody: wrongBody.ok,
      key: shared.screenshotKey('2026-08-07_10-00-00', 'desktop', 'index.png'),
      msg: shared.captureMsg.safeParse({ v: 1, runId: crypto.randomUUID(), itemIds: [crypto.randomUUID()] }).success,
    });
  },
};
`;

describe('runtime compatibility', () => {
  it('runs in workerd without Node APIs', { timeout: 60_000 }, async () => {
    const result = await build({
      stdin: {
        contents: entry,
        resolveDir: fileURLToPath(new URL('.', import.meta.url)),
        loader: 'ts',
      },
      bundle: true,
      format: 'esm',
      platform: 'neutral',
      mainFields: ['module', 'main'],
      write: false,
      logLevel: 'silent',
    });
    const script = result.outputFiles[0]!.text;
    expect(script).not.toMatch(/from\s*["']node:/);

    const mf = new Miniflare({
      workers: [
        {
          config: {
            name: 'shared',
            compatibilityDate: '2026-11-01',
            // recent compatibility dates expose Buffer/process by default; Next.js edge does not
            compatibilityFlags: ['no_nodejs_compat_v2'],
            manifest: {
              mainModule: 'index.js',
              modules: { 'index.js': { type: 'esm', contents: script } },
            },
          },
        },
      ],
    });
    try {
      const response = await mf.dispatchFetch('http://localhost/');
      expect(await response.json()).toEqual({
        roundTrip: 'hunter2',
        valid: true,
        wrongBody: false,
        key: 'screenshots/2026-08-07_10-00-00/desktop/index.png',
        msg: true,
      });
    } finally {
      await mf.dispose();
    }
  });
});
