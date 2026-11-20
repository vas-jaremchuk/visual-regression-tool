/**
 * One-off generator for the engine golden fixtures (specification/11-testing.md §1).
 *
 * The functions below are copied (only whitespace normalised by prettier) from prototype/take-screenshots.js,
 * prototype/files.js, prototype/fetch-sitemap.js and prototype/compare-screenshots.js
 * (prototype/ itself is never modified). Run with the prototype's own dependency versions:
 *
 *   npm i --prefix /tmp/proto-deps pixelmatch@5.3.0 pngjs@6.0.0
 *   PROTO_DEPS=/tmp/proto-deps node fixtures/tools/generate-golden.mjs
 *
 * Writes fixtures/png/*.png and fixtures/golden/*.json.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const depsDir = process.env.PROTO_DEPS;
if (!depsDir)
  throw new Error('Set PROTO_DEPS to a directory with pixelmatch@5.3.0 and pngjs@6.0.0');
const req = createRequire(path.join(path.resolve(depsDir), 'package.json'));
const load = async (name) => (await import(pathToFileURL(req.resolve(name)).href)).default;
const { PNG } = await load('pngjs');
const pixelmatch = await load('pixelmatch');

// ── prototype/take-screenshots.js ────────────────────────────────────────────
function urlToFilename(url) {
  const u = new URL(url);
  const p = (u.pathname + (u.search || '')).replace(/^\//, '') || 'index';
  return (
    p
      .replace(/[^a-z0-9._-]/gi, '_')
      .replace(/_+/g, '_')
      .substring(0, 200) + '.png'
  );
}

// ── prototype/files.js ───────────────────────────────────────────────────────
const FILE_EXTENSIONS = new Set([
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'xlsm',
  'ppt',
  'pptx',
  'pps',
  'ppsx',
  'odt',
  'ods',
  'odp',
  'rtf',
  'csv',
  'txt',
  'xml',
  'json',
  'zip',
  'rar',
  '7z',
  'gz',
  'tar',
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'svg',
  'tif',
  'tiff',
  'bmp',
  'ico',
  'mp3',
  'wav',
  'm4a',
  'mp4',
  'mov',
  'avi',
  'webm',
  'wmv',
  'eps',
  'ai',
  'psd',
]);
function extOf(url) {
  try {
    const p = new URL(url).pathname;
    const m = p.match(/\.([a-z0-9]{1,5})$/i);
    return m ? m[1].toLowerCase() : '';
  } catch {
    return '';
  }
}
function isFileUrl(url) {
  return FILE_EXTENSIONS.has(extOf(url));
}
function isFileScreenshotName(filename) {
  const m = filename.replace(/\.png$/i, '').match(/\.([a-z0-9]{1,5})$/i);
  return !!m && FILE_EXTENSIONS.has(m[1].toLowerCase());
}
function formatFingerprint(fp) {
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
function parseFingerprint(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}
function fingerprintFilename(screenshotFilename) {
  return screenshotFilename.replace(/\.png$/i, '') + '.txt';
}

// ── prototype/fetch-sitemap.js ───────────────────────────────────────────────
function extractLocs(xml) {
  const urls = [];
  for (const m of xml.matchAll(/<loc>\s*(.*?)\s*<\/loc>/gs)) {
    urls.push(m[1].trim().replace(/&amp;/g, '&'));
  }
  return urls;
}

// ── prototype/compare-screenshots.js ─────────────────────────────────────────
const DIFF_THRESHOLD = 0.1;
const HIGHLIGHT_COLOR = [255, 0, 128];
function samePage(a, b) {
  const norm = (u) => {
    const x = new URL(u);
    const host = x.host.replace(/^www\./i, '').toLowerCase();
    const p = x.pathname.replace(/\/+$/, '') || '/';
    return `${host}${p}${x.search}`;
  };
  try {
    return norm(a) === norm(b);
  } catch {
    return false;
  }
}
function readPng(buffer) {
  return PNG.sync.read(buffer);
}
function padPng(png, width, height) {
  if (png.width === width && png.height === height) return png;
  const out = new PNG({ width, height });
  out.data.fill(255);
  PNG.bitblt(png, out, 0, 0, png.width, png.height, 0, 0);
  return out;
}
function diffImages(bufA, bufB) {
  const pngA = readPng(bufA);
  const pngB = readPng(bufB);
  const width = Math.max(pngA.width, pngB.width);
  const height = Math.max(pngA.height, pngB.height);
  const a = padPng(pngA, width, height);
  const b = padPng(pngB, width, height);
  const diffPng = new PNG({ width, height });
  const diffPixels = pixelmatch(a.data, b.data, diffPng.data, width, height, {
    threshold: DIFF_THRESHOLD,
    includeAA: false,
    diffColor: HIGHLIGHT_COLOR,
  });
  return {
    diffPng,
    diffPixels,
    totalPixels: width * height,
    pct: (diffPixels / (width * height)) * 100,
  };
}

// ── Filenames ────────────────────────────────────────────────────────────────
const urls = fs
  .readFileSync(path.join(root, 'urls.txt'), 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean);
const filenames = urls.map((url) => {
  const filename = urlToFilename(url);
  return {
    url,
    filename,
    isFileUrl: isFileUrl(url),
    isFileScreenshotName: isFileScreenshotName(filename),
    fingerprintFilename: fingerprintFilename(filename),
  };
});

// ── Fingerprints ─────────────────────────────────────────────────────────────
const fingerprintInputs = [
  {
    url: 'https://example.com/downloads/report.pdf',
    finalUrl: '',
    status: 200,
    contentType: 'application/pdf',
    lastModified: 'Wed, 18 Nov 2026 10:00:00 GMT',
    etag: '"abc123"',
    fetchedAt: '2026-11-19T12:00:00.000Z',
    sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    size: 0,
  },
  {
    url: 'https://example.com/files/brochure.docx',
    finalUrl: 'https://cdn.example.com/brochure.docx',
    status: 200,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    lastModified: '',
    etag: '',
    fetchedAt: '2026-11-19T12:00:01.000Z',
    sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    size: 4,
  },
  {
    url: 'https://example.com/missing.pdf',
    finalUrl: '',
    status: 404,
    contentType: 'text/html; charset=utf-8',
    lastModified: '',
    etag: '',
    fetchedAt: '2026-11-19T12:00:02.000Z',
    sha256: 'ERROR HTTP 404',
    size: 0,
  },
  {
    url: 'https://example.com/unreachable.zip',
    finalUrl: '',
    status: 0,
    contentType: '',
    lastModified: '',
    etag: '',
    fetchedAt: '2026-11-19T12:00:03.000Z',
    sha256: 'ERROR ECONNREFUSED',
    size: 0,
  },
];
const fingerprints = fingerprintInputs.map((fp) => {
  const text = formatFingerprint(fp);
  return { input: fp, text, parsed: parseFingerprint(text) };
});

// ── Sitemap / samePage ───────────────────────────────────────────────────────
const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/</loc></url>
  <url><loc>
    https://example.com/b?x=1&amp;y=2
  </loc></url>
  <url><loc>https://example.com/a</loc><lastmod>2026-11-01</lastmod></url>
  <url><loc>https://example.com/a</loc></url>
</urlset>`;
const samePagePairs = [
  ['https://example.com/a', 'http://www.example.com/a/'],
  ['https://example.com/a', 'https://example.com/b'],
  ['https://example.com/a?x=1', 'https://example.com/a?x=2'],
  ['https://EXAMPLE.com', 'https://example.com/'],
  ['https://example.com:8443/a', 'https://example.com/a'],
  ['not a url', 'https://example.com/'],
];
const misc = {
  extractLocs: { xml: sitemapXml, locs: extractLocs(sitemapXml) },
  samePage: samePagePairs.map(([a, b]) => ({ a, b, same: samePage(a, b) })),
};

// ── PNG pairs ────────────────────────────────────────────────────────────────
function makePng(width, height, paint) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = paint(x, y);
      const i = (y * width + x) * 4;
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      png.data[i + 3] = a;
    }
  }
  return PNG.sync.write(png);
}
const base = (x, y) => {
  if (y < 8) return [30, 41, 59]; // header bar
  if (x >= 10 && x < 30 && y >= 14 && y < 34) return [220, 38, 38]; // red square
  if ((x + y) % 16 === 0) return [148, 163, 184]; // diagonal lines
  return [255, 255, 255];
};
// Black disc on white with a soft (anti-aliased) edge; `edge` tweaks the edge greys only.
const disc = (edge) => (x, y) => {
  const d = Math.hypot(x - 32, y - 24);
  if (d <= 12) return [0, 0, 0];
  if (d <= 13) {
    const v = Math.round(255 * (d - 12) * edge);
    return [v, v, v];
  }
  return [255, 255, 255];
};
const pairs = {
  identical: [makePng(64, 48, base), makePng(64, 48, base)],
  'one-pixel': [
    makePng(64, 48, base),
    makePng(64, 48, (x, y) => (x === 50 && y === 40 ? [0, 0, 255] : base(x, y))),
  ],
  'height-difference': [
    makePng(64, 48, base),
    makePng(64, 60, (x, y) => (y >= 48 ? [100, 100, 100] : base(x, y))),
  ],
  'width-difference': [
    makePng(70, 48, (x, y) => (x >= 64 ? [0, 128, 0] : base(x, y))),
    makePng(64, 48, base),
  ],
  antialias: [makePng(64, 48, disc(1)), makePng(64, 48, disc(0.6))],
  'block-change': [
    makePng(64, 48, base),
    makePng(64, 48, (x, y) =>
      x >= 40 && x < 56 && y >= 20 && y < 36 ? [16, 185, 129] : base(x, y),
    ),
  ],
};
const pngDiffs = [];
for (const [name, [a, b]] of Object.entries(pairs)) {
  fs.writeFileSync(path.join(root, 'png', `${name}-a.png`), a);
  fs.writeFileSync(path.join(root, 'png', `${name}-b.png`), b);
  const { diffPixels, totalPixels, pct } = diffImages(a, b);
  pngDiffs.push({ name, a: `${name}-a.png`, b: `${name}-b.png`, diffPixels, totalPixels, pct });
}

const write = (file, data) =>
  fs.writeFileSync(path.join(root, 'golden', file), JSON.stringify(data, null, 2) + '\n');
write('filenames.json', filenames);
write('fingerprints.json', fingerprints);
write('png-diffs.json', pngDiffs);
write('misc.json', misc);
console.log(
  `filenames: ${filenames.length}, fingerprints: ${fingerprints.length}, png pairs: ${pngDiffs.length}`,
);
console.table(
  pngDiffs.map(({ name, diffPixels, totalPixels }) => ({ name, diffPixels, totalPixels })),
);
