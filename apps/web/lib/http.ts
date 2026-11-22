import 'server-only';
import { NextResponse } from 'next/server';
import { describeError } from './members/errors';
import { FormError } from './projects/form-result';
import { RateLimitedError } from './rate-limit/limit';

/** Error response in the shape every custom endpoint uses (09). */
export function errorResponse(error: unknown) {
  if (error instanceof FormError) {
    return NextResponse.json(
      { error: { code: 'validation', message: error.message, details: error.fieldErrors } },
      { status: 400 },
    );
  }
  const { status, ...body } = describeError(error);
  const headers =
    error instanceof RateLimitedError
      ? { 'retry-after': String(error.retryAfterSeconds) }
      : undefined;
  return NextResponse.json({ error: body }, { status, headers });
}

export function validationResponse(details: unknown) {
  return NextResponse.json(
    { error: { code: 'validation', message: 'Invalid request body', details } },
    { status: 400 },
  );
}
