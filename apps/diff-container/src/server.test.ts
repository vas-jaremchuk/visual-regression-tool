import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDiffServer } from './server.ts';

describe('diff-container server', () => {
  const server = createDiffServer();
  let baseUrl = '';

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it('responds with a hello message', async () => {
    const res = await fetch(baseUrl);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('Hello from the diff container');
  });
});
