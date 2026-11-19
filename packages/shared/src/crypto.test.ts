import { describe, expect, it } from 'vitest';
import { SecretDecryptionError, decryptSecret, encryptSecret, parseEncryptionKeys } from './crypto';
import { fromBase64, toBase64 } from './encoding';

const key = () => toBase64(crypto.getRandomValues(new Uint8Array(32)));

describe('crypto', () => {
  const keyA = key();
  const keyB = key();

  it('round-trips a secret in the v1 format', async () => {
    const payload = await encryptSecret('s3cr3t påss 🔐', keyA);
    expect(payload).toMatch(/^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(fromBase64(payload.split(':')[1]!)).toHaveLength(12);
    await expect(decryptSecret(payload, keyA)).resolves.toBe('s3cr3t påss 🔐');
  });

  it('uses a random IV per encryption', async () => {
    expect(await encryptSecret('same', keyA)).not.toBe(await encryptSecret('same', keyA));
  });

  it('decrypts with a rotated key and encrypts with the first key', async () => {
    const old = await encryptSecret('legacy', keyA);
    const rotated = `${keyB}, ${keyA}`;
    await expect(decryptSecret(old, rotated)).resolves.toBe('legacy');

    const fresh = await encryptSecret('new', rotated);
    await expect(decryptSecret(fresh, keyB)).resolves.toBe('new');
    await expect(decryptSecret(fresh, keyA)).rejects.toBeInstanceOf(SecretDecryptionError);
  });

  it('rejects tampered ciphertext', async () => {
    const payload = await encryptSecret('secret', keyA);
    const [version, iv, data] = payload.split(':') as [string, string, string];
    const bytes = fromBase64(data);
    bytes[0] = bytes[0]! ^ 0xff;
    await expect(decryptSecret(`${version}:${iv}:${toBase64(bytes)}`, keyA)).rejects.toThrow(
      SecretDecryptionError,
    );
    const otherIv = toBase64(crypto.getRandomValues(new Uint8Array(12)));
    await expect(decryptSecret(`${version}:${otherIv}:${data}`, keyA)).rejects.toThrow(
      SecretDecryptionError,
    );
  });

  it('rejects malformed payloads', async () => {
    for (const payload of ['', 'plain', 'v2:AAAA:AAAA', 'v1:not base64:AAAA', 'v1:AAAA:AAAA']) {
      await expect(decryptSecret(payload, keyA)).rejects.toThrow(SecretDecryptionError);
    }
  });

  it('validates keys', () => {
    expect(parseEncryptionKeys(`${keyA},${keyB}`)).toHaveLength(2);
    expect(() => parseEncryptionKeys('')).toThrow(/at least one/);
    expect(() => parseEncryptionKeys('###')).toThrow(/key #1 is not valid base64/);
    expect(() => parseEncryptionKeys(`${keyA},${toBase64(new Uint8Array(16))}`)).toThrow(
      /key #2 must decode to 32 bytes/,
    );
  });
});
