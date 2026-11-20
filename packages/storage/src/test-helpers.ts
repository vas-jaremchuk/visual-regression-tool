import { vi } from 'vitest';

export interface MockFetch {
  fetch: typeof fetch;
  requests: Request[];
  bodies: string[];
}

/** A fetch mock that records each request (and its body text) and answers from `respond`. */
export function mockFetch(
  respond: (req: Request, index: number) => Response | Promise<Response>,
): MockFetch {
  const requests: Request[] = [];
  const bodies: string[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init);
    requests.push(req);
    bodies.push(req.body ? await req.clone().text() : '');
    return respond(req, requests.length - 1);
  });
  return { fetch: fn as unknown as typeof fetch, requests, bodies };
}

export const noSleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
