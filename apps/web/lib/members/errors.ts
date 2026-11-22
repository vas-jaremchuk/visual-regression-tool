import { ForbiddenError } from '../auth/assert-can';

/** An expected failure with an HTTP status and error code (09: error shape). */
export class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'RequestError';
  }
}

/** Status, code and user-facing message for an error thrown by a route or action. */
export function describeError(error: unknown): {
  status: number;
  code: string;
  message: string;
  details?: unknown;
} {
  if (error instanceof RequestError) {
    const { status, code, message, details } = error;
    return details === undefined ? { status, code, message } : { status, code, message, details };
  }
  if (error instanceof ForbiddenError) {
    return { status: 403, code: 'forbidden', message: error.message };
  }
  console.error(error);
  return { status: 500, code: 'internal', message: 'Something went wrong. Try again.' };
}
