import { fromHex, sha256Hex, toHex, utf8 } from './encoding';
import { HMAC_MAX_SKEW_MS } from './constants';

/**
 * Web → worker request signing (04 §6):
 * `Authorization: VRT-HMAC <timestamp>:<hex hmac_sha256(secret, timestamp \n method \n path \n sha256(body))>`.
 * `timestamp` is Unix seconds. `path` is the request path including any query string.
 * The secret is `WORKER_SHARED_SECRET`, used as UTF-8 bytes.
 */

export const HMAC_SCHEME = 'VRT-HMAC';

export type SignableBody = string | Uint8Array<ArrayBuffer> | null | undefined;

export interface SignInput {
  secret: string;
  method: string;
  path: string;
  body?: SignableBody;
  /** Defaults to `Date.now()`. */
  now?: number;
}

export interface VerifyInput extends SignInput {
  header: string | null | undefined;
  maxSkewMs?: number;
}

export type VerifyResult =
  | { ok: true; timestamp: number }
  | { ok: false; reason: 'missing' | 'malformed' | 'skew' | 'signature' };

async function stringToSign(timestamp: string, method: string, path: string, body: SignableBody) {
  const bodyHash = await sha256Hex(body ?? '');
  return `${timestamp}\n${method.toUpperCase()}\n${path}\n${bodyHash}`;
}

function importHmacKey(secret: string) {
  return crypto.subtle.importKey('raw', utf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

/** Returns the full `Authorization` header value. */
export async function signRequest(input: SignInput): Promise<string> {
  const timestamp = String(Math.floor((input.now ?? Date.now()) / 1000));
  const message = await stringToSign(timestamp, input.method, input.path, input.body);
  const signature = await crypto.subtle.sign(
    'HMAC',
    await importHmacKey(input.secret),
    utf8(message),
  );
  return `${HMAC_SCHEME} ${timestamp}:${toHex(new Uint8Array(signature))}`;
}

export async function verifyRequest(input: VerifyInput): Promise<VerifyResult> {
  if (!input.header) return { ok: false, reason: 'missing' };
  const match = /^VRT-HMAC (\d{1,15}):([0-9a-f]{64})$/i.exec(input.header.trim());
  if (!match) return { ok: false, reason: 'malformed' };
  const [, timestamp, signatureHex] = match as unknown as [string, string, string];

  const skew = Math.abs((input.now ?? Date.now()) - Number(timestamp) * 1000);
  if (skew > (input.maxSkewMs ?? HMAC_MAX_SKEW_MS)) return { ok: false, reason: 'skew' };

  const message = await stringToSign(timestamp, input.method, input.path, input.body);
  // subtle.verify compares in constant time
  const valid = await crypto.subtle.verify(
    'HMAC',
    await importHmacKey(input.secret),
    fromHex(signatureHex)!,
    utf8(message),
  );
  return valid ? { ok: true, timestamp: Number(timestamp) } : { ok: false, reason: 'signature' };
}
