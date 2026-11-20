import { describe, expect, it } from 'vitest';
import { buildComparisonMatrix, type MatrixRunItem } from './matrix';

const page = (vp: string, filename: string, extra: Partial<MatrixRunItem> = {}): MatrixRunItem => ({
  url: `https://example.com/${filename.replace(/\.png$/, '')}`,
  kind: 'page',
  viewport_slug: vp,
  filename,
  status: 'done',
  ...extra,
});
const file = (
  filename: string,
  sha256: string,
  extra: Partial<MatrixRunItem> = {},
): MatrixRunItem => ({
  url: `https://example.com/${filename.replace(/\.png$/, '')}`,
  kind: 'file',
  viewport_slug: null,
  filename,
  status: 'done',
  sha256,
  ...extra,
});

describe('buildComparisonMatrix', () => {
  const before = [
    page('desktop', 'same.png'),
    page('desktop', 'gone.png'),
    page('desktop', 'broken.png'),
    page('desktop', 'pending.png'),
    page('tablet', 'same.png'),
    file('r.pdf.png', 'aaa'),
    file('s.pdf.png', 'bbb'),
    file('old.pdf.png', 'ccc'),
    file('err.pdf.png', 'ERROR HTTP 404'),
  ];
  const after = [
    page('desktop', 'same.png'),
    page('desktop', 'added.png'),
    page('desktop', 'broken.png', { status: 'failed', error: 'Navigation timeout' }),
    page('desktop', 'pending.png', { status: 'pending' }),
    page('mobile', 'same.png'),
    file('r.pdf.png', 'aaa'),
    file('s.pdf.png', 'ddd'),
    file('new.pdf.png', 'eee'),
    file('err.pdf.png', 'x', { status: 'failed' }),
  ];
  const m = buildComparisonMatrix(before, after);
  const status = Object.fromEntries(
    m.entries.map((e) => [`${e.kind}:${e.viewport_slug ?? '-'}:${e.filename}`, e.status]),
  );

  it('keys entries by kind, viewport and filename', () => {
    expect(status).toEqual({
      'file:-:err.pdf.png': 'error',
      'file:-:new.pdf.png': 'new',
      'file:-:old.pdf.png': 'missing',
      'file:-:r.pdf.png': 'unchanged',
      'file:-:s.pdf.png': 'changed',
      'page:desktop:added.png': 'new',
      'page:desktop:broken.png': 'error',
      'page:desktop:gone.png': 'missing',
      'page:desktop:pending.png': 'error',
      'page:desktop:same.png': 'pending',
    });
  });

  it('only compares viewports present in both runs', () => {
    expect(m.viewports).toEqual(['desktop']);
    expect(m.viewportsNotInAfter).toEqual(['tablet']);
    expect(m.viewportsNotInBefore).toEqual(['mobile']);
  });

  it('keeps references, names and error reasons', () => {
    const broken = m.entries.find((e) => e.filename === 'broken.png')!;
    expect(broken.error).toBe('after: Navigation timeout');
    expect(m.entries.find((e) => e.filename === 'pending.png')!.error).toBe('after: item pending');
    const same = m.entries.find((e) => e.filename === 'same.png')!;
    expect(same.before).toBe(before[0]);
    expect(same.after).toBe(after[0]);
    expect(same.name).toBe('same');
    expect(m.entries.find((e) => e.filename === 'gone.png')!.after).toBeNull();
  });

  it('accepts explicit run viewports and matches files whatever their viewport field says', () => {
    const res = buildComparisonMatrix(
      [file('a.pdf.png', 'x', { viewport_slug: 'desktop' })],
      [file('a.pdf.png', 'x'), page('desktop', 'p.png')],
      { beforeViewports: ['desktop'], afterViewports: ['desktop'] },
    );
    expect(res.entries.map((e) => [e.filename, e.status, e.viewport_slug])).toEqual([
      ['a.pdf.png', 'unchanged', null],
      ['p.png', 'new', 'desktop'],
    ]);
    expect(res.viewports).toEqual(['desktop']);
  });

  it('treats missing sha256 values as equal', () => {
    const res = buildComparisonMatrix(
      [file('a.pdf.png', 'x', { sha256: null })],
      [file('a.pdf.png', 'x', { sha256: undefined })],
    );
    expect(res.entries[0]!.status).toBe('unchanged');
  });
});
