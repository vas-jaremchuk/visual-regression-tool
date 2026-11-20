import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Fetcher } from '../types';

export const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../fixtures',
);

export function readGolden<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, 'golden', name), 'utf8')) as T;
}

export function readFixture(...parts: string[]): Buffer {
  return fs.readFileSync(path.join(FIXTURES, ...parts));
}

export interface Call {
  url: string;
  init: RequestInit | undefined;
}

type Handler = (url: string, init: RequestInit | undefined) => Response | Promise<Response>;

/** Fake `fetch` that records calls and answers from `handler`. */
export function fakeFetcher(handler: Handler): Fetcher & { calls: Call[] } {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    return handler(url, init);
  }) as Fetcher & { calls: Call[] };
  fn.calls = calls;
  return fn;
}

export function response(
  body: ConstructorParameters<typeof Response>[0],
  init: ResponseInit & { url?: string } = {},
): Response {
  const res = new Response(body, init);
  if (init.url) Object.defineProperty(res, 'url', { value: init.url });
  return res;
}

export function networkError(code: string, message = 'fetch failed'): Error {
  return Object.assign(new TypeError(message), { cause: { code } });
}
