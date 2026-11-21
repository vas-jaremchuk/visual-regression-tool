import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { ApiErrorResponse, ObjectStore } from '@vrt/shared';
import { DiffError, runDiff } from './diff.ts';

/** The JSON request body is a handful of keys and regions; anything larger is not a diff request. */
export const MAX_BODY_BYTES = 1024 * 1024;

export interface DiffServerOptions {
  store: ObjectStore;
  /** `DIFF_CONTAINER_SHARED_SECRET`, sent by the worker as `Authorization: Bearer <secret>`. */
  sharedSecret: string;
  onError?: (error: unknown) => void;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function sendError(res: ServerResponse, error: DiffError): void {
  const body: ApiErrorResponse = { error: { code: error.code, message: error.message } };
  if (error.details !== undefined) body.error.details = error.details;
  sendJson(res, error.status, body);
}

const digest = (value: string) => createHash('sha256').update(value).digest();

function isAuthorized(header: string | undefined, secret: string): boolean {
  const match = /^Bearer (.+)$/.exec(header ?? '');
  // Comparing digests keeps the comparison constant-time whatever the token's length.
  return !!match && timingSafeEqual(digest(match[1]!), digest(secret));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.byteLength;
    if (size > MAX_BODY_BYTES) {
      throw new DiffError(413, 'validation_error', `Request body exceeds ${MAX_BODY_BYTES} bytes`);
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new DiffError(400, 'validation_error', 'Request body is not valid JSON');
  }
}

/** Diff container HTTP server (06 §6, 09 §4): `GET /health` and bearer-authenticated `POST /diff`. */
export function createDiffServer(options: DiffServerOptions): Server {
  const { store, sharedSecret, onError = console.error } = options;

  return createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    try {
      if (path === '/health') {
        if (req.method !== 'GET') throw new DiffError(405, 'method_not_allowed', 'Use GET /health');
        sendJson(res, 200, { ok: true });
        return;
      }
      if (path === '/diff') {
        if (req.method !== 'POST') throw new DiffError(405, 'method_not_allowed', 'Use POST /diff');
        if (!isAuthorized(req.headers.authorization, sharedSecret)) {
          throw new DiffError(401, 'unauthorized', 'Missing or invalid bearer token');
        }
        sendJson(res, 200, await runDiff(store, await readJson(req)));
        return;
      }
      throw new DiffError(404, 'not_found', `No route for ${req.method} ${path}`);
    } catch (error) {
      if (error instanceof DiffError) {
        sendError(res, error);
        return;
      }
      onError(error);
      const message = error instanceof Error ? error.message : String(error);
      sendError(res, new DiffError(500, 'internal_error', `Diff failed: ${message}`));
    }
  });
}
