/**
 * URL → screenshot filename (specification/05-engine.md §1, REQ-ENG-1).
 * Must stay byte-identical with prototype/take-screenshots.js `urlToFilename`.
 */
export function urlToFilename(url: string): string {
  return urlToName(url) + '.png';
}

/** Filename without the `.png` extension (prototype `buildUrlMap` key). */
export function urlToName(url: string): string {
  const u = new URL(url);
  const p = (u.pathname + (u.search || '')).replace(/^\//, '') || 'index';
  return p
    .replace(/[^a-z0-9._-]/gi, '_')
    .replace(/_+/g, '_')
    .substring(0, 200);
}

export interface AssignedFilename {
  url: string;
  filename: string;
  /** Set when the plain filename was already taken by an earlier URL. */
  collidesWith?: string;
}

/**
 * Assigns filenames to a run's URLs. When two URLs map to the same name, the second one
 * gets the suffix `__2`, the third `__3`, and so on (in input order).
 */
export function assignFilenames(urls: readonly string[]): AssignedFilename[] {
  const firstUrl = new Map<string, string>();
  const taken = new Set<string>();
  const counts = new Map<string, number>();
  return urls.map((url) => {
    const name = urlToName(url);
    const first = firstUrl.get(name);
    if (first === undefined) {
      firstUrl.set(name, url);
      taken.add(name);
      return { url, filename: name + '.png' };
    }
    let n = counts.get(name) ?? 1;
    let candidate: string;
    do {
      n++;
      candidate = `${name}__${n}`;
    } while (taken.has(candidate));
    counts.set(name, n);
    taken.add(candidate);
    return { url, filename: candidate + '.png', collidesWith: first };
  });
}
