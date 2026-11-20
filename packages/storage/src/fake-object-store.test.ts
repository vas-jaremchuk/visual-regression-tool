import { describe, expect, it } from 'vitest';
import { ObjectNotFoundError } from './errors';
import { FakeObjectStore } from './testing';

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

describe('FakeObjectStore', () => {
  it('round-trips objects and reports heads', async () => {
    const s = new FakeObjectStore();
    await s.put('b', 'k', new Uint8Array([1, 2]), 'image/png');

    expect(await s.get('b', 'k')).toEqual(new Uint8Array([1, 2]));
    expect(await s.head('b', 'k')).toEqual({ size: 2, contentType: 'image/png', etag: null });
    expect(await s.head('b', 'missing')).toBeNull();
    await expect(s.get('b', 'missing')).rejects.toBeInstanceOf(ObjectNotFoundError);
  });

  it('lists sorted by key with prefix and delimiter', async () => {
    const s = new FakeObjectStore();
    for (const key of ['s/2/b.png', 's/1/a.png', 's/top.png', 'other/x.png']) {
      await s.put('b', key, new Uint8Array(3), 'image/png');
    }

    expect((await collect(s.list('b', 's/'))).map((e) => e.key)).toEqual([
      's/1/a.png',
      's/2/b.png',
      's/top.png',
    ]);
    expect(await collect(s.list('b', 's/', { delimiter: '/' }))).toEqual([
      { key: 's/top.png', size: 3 },
    ]);
    expect(await collect(s.listPrefixes('b', 's/'))).toEqual(['s/1/', 's/2/']);
  });

  it('deletes keys, ignoring missing ones', async () => {
    const s = new FakeObjectStore();
    await s.put('b', 'a', new Uint8Array(1), 'x');
    await s.put('b', 'c', new Uint8Array(1), 'x');

    await s.delete('b', ['a', 'nope']);

    expect((await collect(s.list('b', ''))).map((e) => e.key)).toEqual(['c']);
  });
});
