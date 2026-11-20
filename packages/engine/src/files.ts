/** Page vs file classification (specification/05-engine.md §2, REQ-ENG-2). */

/** Links with these extensions are fingerprinted instead of screenshotted. */
// prettier-ignore
export const FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  'pdf',
  'doc', 'docx', 'xls', 'xlsx', 'xlsm', 'ppt', 'pptx', 'pps', 'ppsx',
  'odt', 'ods', 'odp', 'rtf', 'csv', 'txt', 'xml', 'json',
  'zip', 'rar', '7z', 'gz', 'tar',
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'tif', 'tiff', 'bmp', 'ico',
  'mp3', 'wav', 'm4a', 'mp4', 'mov', 'avi', 'webm', 'wmv',
  'eps', 'ai', 'psd',
]);

/** Project `file_extensions` override, or the default list when null/undefined. */
export type FileExtensions = ReadonlySet<string> | readonly string[] | null | undefined;

function toSet(extensions: FileExtensions): ReadonlySet<string> {
  if (!extensions) return FILE_EXTENSIONS;
  if (extensions === FILE_EXTENSIONS) return FILE_EXTENSIONS;
  return new Set([...extensions].map((e) => e.toLowerCase().replace(/^\./, '')));
}

/** Extension of the URL path (lowercase, no dot) or ''. */
export function extOf(url: string): string {
  try {
    const p = new URL(url).pathname;
    const m = p.match(/\.([a-z0-9]{1,5})$/i);
    return m?.[1] ? m[1].toLowerCase() : '';
  } catch {
    return '';
  }
}

/** True if the URL points to a downloadable file rather than an HTML page. */
export function isFileUrl(url: string, extensions?: FileExtensions): boolean {
  return toSet(extensions).has(extOf(url));
}

/**
 * True if a screenshot filename (e.g. "..._Newsletter.pdf.png") belongs to a file link.
 * Used by legacy import to ignore screenshots of PDFs etc. taken by old prototype runs.
 */
export function isFileScreenshotName(filename: string, extensions?: FileExtensions): boolean {
  const m = filename.replace(/\.png$/i, '').match(/\.([a-z0-9]{1,5})$/i);
  return !!m?.[1] && toSet(extensions).has(m[1].toLowerCase());
}
