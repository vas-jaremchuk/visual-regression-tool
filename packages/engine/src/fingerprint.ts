/** File fingerprinting (specification/05-engine.md §5, REQ-ENG-5). Port of prototype/files.js. */
import { FILE_FETCH_MAX_ATTEMPTS, FILE_FETCH_TIMEOUT_MS } from '@vrt/shared';
import { Sha256 } from './sha256';
import type { Fetcher } from './types';
import { defaultSleep, discardBody, errorReason, type Sleep } from './util';

export const FINGERPRINT_USER_AGENT = 'Mozilla/5.0 (visual-test fingerprint)';
const RETRY_STATUSES = [429, 500, 502, 503, 504];

export interface Fingerprint {
  url: string;
  finalUrl: string;
  sha256: string;
  size: number;
  status: number;
  contentType: string;
  lastModified: string;
  etag: string;
  fetchedAt: string;
}

export interface FingerprintOptions {
  timeoutMs?: number;
  retries?: number;
  sleep?: Sleep;
  now?: () => Date;
}

/**
 * Downloads a file and computes its SHA-256 (streamed). Never throws: on failure the
 * fingerprint is "ERROR <reason>", so a broken link still shows up as a change.
 */
export async function fingerprintUrl(
  url: string,
  headers: Record<string, string>,
  fetcher: Fetcher,
  opts: FingerprintOptions = {},
): Promise<Fingerprint> {
  const timeoutMs = opts.timeoutMs ?? FILE_FETCH_TIMEOUT_MS;
  const retries = opts.retries ?? FILE_FETCH_MAX_ATTEMPTS;
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? (() => new Date());
  let lastErr: unknown;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetcher(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'User-Agent': FINGERPRINT_USER_AGENT, ...headers },
      });

      const meta = {
        url,
        finalUrl: res.url && res.url !== url ? res.url : '',
        status: res.status,
        contentType: res.headers.get('content-type') || '',
        lastModified: res.headers.get('last-modified') || '',
        etag: res.headers.get('etag') || '',
        fetchedAt: now().toISOString(),
      };

      if (!res.ok) {
        await discardBody(res);
        if (RETRY_STATUSES.includes(res.status) && attempt < retries) {
          await sleep(attempt * 2000);
          continue;
        }
        return { ...meta, sha256: `ERROR HTTP ${res.status}`, size: 0 };
      }

      const hash = new Sha256();
      let size = 0;
      if (res.body) {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          hash.update(value);
          size += value.length;
        }
      }
      return { ...meta, sha256: hash.digestHex(), size };
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(attempt * 2000);
    }
  }

  return {
    url,
    finalUrl: '',
    status: 0,
    contentType: '',
    lastModified: '',
    etag: '',
    fetchedAt: now().toISOString(),
    sha256: `ERROR ${lastErr ? errorReason(lastErr) : 'unknown'}`,
    size: 0,
  };
}

/** Serialises a fingerprint as the prototype's "key: value" text file. */
export function formatFingerprint(fp: Fingerprint): string {
  return (
    [
      `url: ${fp.url}`,
      fp.finalUrl ? `final-url: ${fp.finalUrl}` : null,
      `sha256: ${fp.sha256}`,
      `size: ${fp.size}`,
      `status: ${fp.status}`,
      `content-type: ${fp.contentType}`,
      `last-modified: ${fp.lastModified}`,
      `etag: ${fp.etag}`,
      `fetched-at: ${fp.fetchedAt}`,
    ]
      .filter((l) => l !== null)
      .join('\n') + '\n'
  );
}

/** Parses a fingerprint text file back into an object (keys as written). */
export function parseFingerprint(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of String(text).split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

/** Fingerprint filename for a screenshot filename (`foo.pdf.png` → `foo.pdf.txt`). */
export function fingerprintFilename(screenshotFilename: string): string {
  return screenshotFilename.replace(/\.png$/i, '') + '.txt';
}
