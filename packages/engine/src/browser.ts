/**
 * Browser abstraction (specification/05-engine.md §4, §10, ADR-2). The worker implements it with
 * Browser Rendering; a container with `puppeteer-core` can implement it later without touching
 * the capture consumer.
 */

export interface CaptureViewport {
  width: number;
  height: number;
  deviceScaleFactor: number;
  isMobile: boolean;
}

export interface BasicAuthCredentials {
  username: string;
  password: string;
}

/** Everything a session needs to capture one page (05 §4 steps 1–6). */
export interface CaptureJob {
  url: string;
  viewport: CaptureViewport;
  basicAuth: BasicAuthCredentials | null;
  /** `buildInjectedCss(...)` for this URL and viewport. */
  css: string;
  pageTimeoutMs: number;
  settleMs: number;
  maxPageHeight: number;
}

export interface CaptureResult {
  png: Uint8Array;
  /** True when the document was taller than `maxPageHeight` and the screenshot was clipped. */
  truncated: boolean;
}

export interface BrowserSession {
  /** Throws on navigation timeout or crash; the caller then closes this session and opens another. */
  capture(job: CaptureJob): Promise<CaptureResult>;
  close(): Promise<void>;
}

export interface BrowserProvider {
  openSession(): Promise<BrowserSession>;
}

/** Width and height from a PNG's IHDR chunk; throws when the bytes are not a PNG. */
export function pngSize(png: Uint8Array): { width: number; height: number } {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const isPng =
    png.length >= 24 &&
    signature.every((b, i) => png[i] === b) &&
    String.fromCharCode(png[12]!, png[13]!, png[14]!, png[15]!) === 'IHDR';
  if (!isPng) throw new Error('Not a PNG image');
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}
