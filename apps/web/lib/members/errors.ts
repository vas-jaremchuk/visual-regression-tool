import { ForbiddenError } from '../auth/assert-can';

/** An expected failure with an HTTP status and error code (09: error shape). */
export class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RequestError';
  }
}

/** Status, code and user-facing message for an error thrown by a route or action. */
export function describeError(error: unknown): { status: number; code: string; message: string } {
  if (error instanceof RequestError) {
    return { status: error.status, code: error.code, message: error.message };
  }
  if (error instanceof ForbiddenError) {
    return { status: 403, code: 'forbidden', message: error.message };
  }
  console.error(error);
  return { status: 500, code: 'internal', message: 'Something went wrong. Try again.' };
}
