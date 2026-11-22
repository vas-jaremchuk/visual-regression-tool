/**
 * Legacy import of prototype runs (specification/07-features.md F-RUN-6, 02 §3 legacy layout,
 * 05 §1, §2, §5). Turns the object listing of `screenshots/<ts>/` into `run_items` rows.
 */
import { LEGACY_VIEWPORT_SLUG, parseLegacyKey, runItemKey } from '@vrt/shared';
import { assignFilenames, urlToFilename } from './filename';
import { isFileScreenshotName, type FileExtensions } from './files';
import { parseFingerprint } from './fingerprint';

/** A `run_items` row of an imported legacy run; every item is `done`. */
export interface LegacyRunItem {
  /** null when the URL cannot be reconstructed; the item is then shown by filename. */
  url: string | null;
  kind: 'page' | 'file';
  viewport_slug: typeof LEGACY_VIEWPORT_SLUG | null;
  filename: string;
  r2_key: string;
  bytes: number | null;
  sha256: string | null;
  http_status: number | null;
  content_type: string | null;
  last_modified: string | null;
  etag: string | null;
  final_url: string | null;
}

export interface LegacyRunInput {
  label: string;
  /** Objects listed under `screenshots/<label>/`. */
  objects: readonly { key: string; size: number }[];
  /** Fingerprint text by object key, for the `.txt` objects. */
  fingerprints: ReadonlyMap<string, string>;
  /** Page URL by screenshot filename, from `legacyPageUrls`. */
  pageUrls: ReadonlyMap<string, string>;
  /** Project `file_extensions` (null = engine default). */
  fileExtensions?: FileExtensions;
}

export interface LegacyRunPlan {
  items: LegacyRunItem[];
  /** Keys that are not imported: screenshots of file links and objects outside the layout. */
  skipped: string[];
}

/**
 * Page URL by screenshot filename, reconstructed from a sitemap snapshot. Included page URLs get
 * the filenames a new run would give them (05 §1, `__N` suffixes included); other snapshot URLs
 * only fill names still unknown.
 */
export function legacyPageUrls(
  urls: readonly { url: string; kind: 'page' | 'file'; included: boolean }[],
): Map<string, string> {
  const sorted = [...urls]
    .filter((u) => u.kind === 'page')
    .sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
  const map = new Map<string, string>();
  for (const { url, filename } of assignFilenames(
    sorted.filter((u) => u.included).map((u) => u.url),
  )) {
    map.set(filename, url);
  }
  for (const { url, included } of sorted) {
    if (included) continue;
    const filename = urlToFilename(url);
    if (!map.has(filename)) map.set(filename, url);
  }
  return map;
}

function text(value: string | undefined): string | null {
  return value ? value : null;
}

function int(value: string | undefined): number | null {
  const n = value ? Number(value) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Items of a legacy run: each `.png` is a `desktop` page (screenshots of file links such as
 * `doc.pdf.png` are skipped), each `.txt` is a file whose fingerprint gives its URL and hash.
 */
export function buildLegacyRunItems(input: LegacyRunInput): LegacyRunPlan {
  const items: LegacyRunItem[] = [];
  const skipped: string[] = [];
  const seenUrls = new Set<string>();

  const objects = [...input.objects].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const { key, size } of objects) {
    const parsed = parseLegacyKey(key);
    if (
      !parsed ||
      parsed.runLabel !== input.label ||
      (parsed.kind === 'page' && isFileScreenshotName(parsed.filename, input.fileExtensions))
    ) {
      skipped.push(key);
      continue;
    }
    const r2Key = runItemKey({
      runLabel: input.label,
      isLegacy: true,
      kind: parsed.kind,
      viewportSlug: parsed.viewportSlug,
      filename: parsed.filename,
    });

    let item: LegacyRunItem;
    if (parsed.kind === 'page') {
      item = {
        url: input.pageUrls.get(parsed.filename) ?? null,
        kind: 'page',
        viewport_slug: LEGACY_VIEWPORT_SLUG,
        filename: parsed.filename,
        r2_key: r2Key,
        bytes: size,
        sha256: null,
        http_status: null,
        content_type: null,
        last_modified: null,
        etag: null,
        final_url: null,
      };
    } else {
      const fp = parseFingerprint(input.fingerprints.get(key) ?? '');
      const size = Number(fp.size);
      item = {
        url: text(fp.url),
        kind: 'file',
        viewport_slug: null,
        filename: parsed.filename,
        r2_key: r2Key,
        bytes: Number.isFinite(size) ? size : null,
        sha256: text(fp.sha256),
        http_status: int(fp.status),
        content_type: text(fp['content-type']),
        last_modified: text(fp['last-modified']),
        etag: text(fp.etag),
        final_url: text(fp['final-url']),
      };
    }
    // (run_id, url, viewport) is unique: a URL already taken in this run is shown by filename.
    if (item.url !== null) {
      const urlKey = `${item.url}\u0000${item.viewport_slug ?? ''}`;
      if (seenUrls.has(urlKey)) item.url = null;
      else seenUrls.add(urlKey);
    }
    items.push(item);
  }
  return { items, skipped };
}
