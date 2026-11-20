import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Sha256, sha256Hex } from './sha256';

const nodeHash = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

describe('Sha256', () => {
  it('matches node:crypto for lengths around block boundaries', () => {
    for (const len of [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000, 70_000]) {
      const data = new Uint8Array(len).map((_, i) => (i * 31 + len) & 0xff);
      expect(sha256Hex(data), `len ${len}`).toBe(nodeHash(data));
    }
  });

  it('gives the same digest regardless of chunking', () => {
    const data = new Uint8Array(5000).map((_, i) => (i * 7) & 0xff);
    for (const chunk of [1, 13, 64, 100, 4999]) {
      const h = new Sha256();
      for (let i = 0; i < data.length; i += chunk) h.update(data.subarray(i, i + chunk));
      expect(h.digestHex(), `chunk ${chunk}`).toBe(nodeHash(data));
    }
  });

  it('is idempotent on digest and rejects updates afterwards', () => {
    const h = new Sha256().update(new TextEncoder().encode('abc'));
    const first = h.digestHex();
    expect(first).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(h.digestHex()).toBe(first);
    expect(() => h.update(new Uint8Array(1))).toThrow();
  });
});
