import { describe, expect, it } from 'vitest';
import worker from './index';

describe('worker', () => {
  it('responds with a hello message', async () => {
    const res = await worker.fetch();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('Hello from the visual regression worker');
  });
});
