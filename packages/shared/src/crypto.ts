import { fromBase64, toBase64, utf8 } from './encoding';

/**
 * AES-256-GCM secret encryption (03 §5). Format: `v1:<iv b64>:<ciphertext+tag b64>`.
 * The keyring is the raw `SETTINGS_ENCRYPTION_KEY` value: a comma-separated list of base64
 * 32-byte keys. The first key encrypts; every key is tried on decrypt (rotation).
 */

const VERSION = 'v1';
const IV_BYTES = 12;
const KEY_BYTES = 32;

export class SecretDecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretDecryptionError';
  }
}

/** Splits and decodes a keyring; throws with a message naming the bad entry. */
export function parseEncryptionKeys(keyring: string): Uint8Array<ArrayBuffer>[] {
  const entries = keyring
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.length === 0) throw new Error('expected at least one base64 key');
  return entries.map((entry, index) => {
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = fromBase64(entry);
    } catch {
      throw new Error(`key #${index + 1} is not valid base64`);
    }
    if (bytes.length !== KEY_BYTES) {
      throw new Error(`key #${index + 1} must decode to ${KEY_BYTES} bytes, got ${bytes.length}`);
    }
    return bytes;
  });
}

function importKey(raw: Uint8Array<ArrayBuffer>) {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptSecret(plaintext: string, keyring: string): Promise<string> {
  const [first] = parseEncryptionKeys(keyring);
  const key = await importKey(first!);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, utf8(plaintext));
  return `${VERSION}:${toBase64(iv)}:${toBase64(new Uint8Array(ciphertext))}`;
}

export async function decryptSecret(payload: string, keyring: string): Promise<string> {
  const parts = payload.split(':');
  if (parts.length !== 3 || parts[0] !== VERSION) {
    throw new SecretDecryptionError('Unsupported secret format');
  }
  let iv: Uint8Array<ArrayBuffer>;
  let ciphertext: Uint8Array<ArrayBuffer>;
  try {
    iv = fromBase64(parts[1]!);
    ciphertext = fromBase64(parts[2]!);
  } catch {
    throw new SecretDecryptionError('Malformed secret payload');
  }
  if (iv.length !== IV_BYTES) throw new SecretDecryptionError('Malformed secret payload');

  for (const raw of parseEncryptionKeys(keyring)) {
    try {
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        await importKey(raw),
        ciphertext,
      );
      return new TextDecoder().decode(plaintext);
    } catch {
      // wrong key or tampered ciphertext: try the next key
    }
  }
  throw new SecretDecryptionError('Secret could not be decrypted with any configured key');
}
