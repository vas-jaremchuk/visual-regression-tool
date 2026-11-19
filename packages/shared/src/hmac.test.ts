import { describe, expect, it } from 'vitest';
import { sha256Hex, toHex, utf8 } from './encoding';
import { signRequest, verifyRequest } from './hmac';

const secret = 'test-secret-that-is-at-least-32-chars-long';
const now = Date.UTC(2026, 10, 19, 12, 0, 0);
const request = { secret, method: 'POST', path: '/jobs/capture', body: '{"runId":"r1"}', now };

describe('hmac', () => {
  it('produces the documented header format', async () => {
    const header = await signRequest(request);
    const timestamp = String(now / 1000);
    const message = `${timestamp}\nPOST\n/jobs/capture\n${await sha256Hex(request.body)}`;
    const key = await crypto.subtle.importKey(
      'raw',
      utf8(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const expected = toHex(new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8(message))));
    expect(header).toBe(`VRT-HMAC ${timestamp}:${expected}`);
  });

  it('accepts a valid signature, including within the skew window', async () => {
    const header = await signRequest(request);
    await expect(verifyRequest({ ...request, header })).resolves.toEqual({
      ok: true,
      timestamp: now / 1000,
    });
    await expect(
      verifyRequest({ ...request, header, now: now + 5 * 60_000 }),
    ).resolves.toMatchObject({ ok: true });
    await expect(verifyRequest({ ...request, header, method: 'post' })).resolves.toMatchObject({
      ok: true,
    });
  });

  it('accepts an empty body signed as null', async () => {
    const header = await signRequest({ ...request, body: null });
    await expect(verifyRequest({ ...request, body: '', header })).resolves.toMatchObject({
      ok: true,
    });
  });

  it('rejects a wrong body', async () => {
    const header = await signRequest(request);
    await expect(verifyRequest({ ...request, header, body: '{"runId":"r2"}' })).resolves.toEqual({
      ok: false,
      reason: 'signature',
    });
  });

  it('rejects a wrong path or method', async () => {
    const header = await signRequest(request);
    await expect(verifyRequest({ ...request, header, path: '/jobs/compare' })).resolves.toEqual({
      ok: false,
      reason: 'signature',
    });
    await expect(verifyRequest({ ...request, header, method: 'GET' })).resolves.toEqual({
      ok: false,
      reason: 'signature',
    });
  });

  it('rejects a wrong secret', async () => {
    const header = await signRequest({ ...request, secret: `${secret}x` });
    await expect(verifyRequest({ ...request, header })).resolves.toEqual({
      ok: false,
      reason: 'signature',
    });
  });

  it('rejects clock skew over 5 minutes in either direction', async () => {
    const header = await signRequest(request);
    for (const skew of [5 * 60_000 + 1000, -(5 * 60_000 + 1000)]) {
      await expect(verifyRequest({ ...request, header, now: now + skew })).resolves.toEqual({
        ok: false,
        reason: 'skew',
      });
    }
  });

  it('rejects missing and malformed headers', async () => {
    await expect(verifyRequest({ ...request, header: null })).resolves.toEqual({
      ok: false,
      reason: 'missing',
    });
    for (const header of ['Bearer abc', 'VRT-HMAC 123', 'VRT-HMAC abc:def', 'VRT-HMAC 1:zz']) {
      await expect(verifyRequest({ ...request, header })).resolves.toEqual({
        ok: false,
        reason: 'malformed',
      });
    }
  });
});
