// Minimal XML helpers for the few S3 responses we read; workerd has no DOMParser.

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

export function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code =
        entity[1] === 'x' || entity[1] === 'X'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return String.fromCodePoint(code);
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Inner text of every `<name>…</name>` element (not nested in itself). */
export function elements(xml: string, name: string): string[] {
  const re = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'g');
  return Array.from(xml.matchAll(re), (m) => m[1] ?? '');
}

/** Decoded text of the first `<name>` element, or undefined. */
export function text(xml: string, name: string): string | undefined {
  const first = elements(xml, name)[0];
  return first === undefined ? undefined : decodeXml(first);
}

export interface ListPage {
  objects: { key: string; size: number }[];
  prefixes: string[];
  isTruncated: boolean;
  nextContinuationToken: string | undefined;
}

export function parseListObjectsV2(xml: string): ListPage {
  const prefixes = elements(xml, 'CommonPrefixes')
    .map((block) => text(block, 'Prefix'))
    .filter((p): p is string => p !== undefined);
  // Drop CommonPrefixes blocks so their <Prefix> never shadows anything below.
  const body = xml.replace(/<CommonPrefixes>[\s\S]*?<\/CommonPrefixes>/g, '');
  const objects = elements(body, 'Contents').map((block) => ({
    key: text(block, 'Key') ?? '',
    size: Number(text(block, 'Size') ?? 0),
  }));
  return {
    objects,
    prefixes,
    isTruncated: text(body, 'IsTruncated') === 'true',
    nextContinuationToken: text(body, 'NextContinuationToken'),
  };
}

export interface DeleteError {
  key: string;
  code: string;
  message: string;
}

export function parseDeleteErrors(xml: string): DeleteError[] {
  return elements(xml, 'Error').map((block) => ({
    key: text(block, 'Key') ?? '',
    code: text(block, 'Code') ?? '',
    message: text(block, 'Message') ?? '',
  }));
}
