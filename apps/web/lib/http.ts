import 'server-only';
import { NextResponse } from 'next/server';
import { describeError } from './members/errors';
import { FormError } from './projects/form-result';

/** Error response in the shape every custom endpoint uses (09). */
export function errorResponse(error: unknown) {
  if (error instanceof FormError) {
    return NextResponse.json(
      { error: { code: 'validation', message: error.message, details: error.fieldErrors } },
      { status: 400 },
    );
  }
  const { status, ...body } = describeError(error);
  return NextResponse.json({ error: body }, { status });
}

export function validationResponse(details: unknown) {
  return NextResponse.json(
    { error: { code: 'validation', message: 'Invalid request body', details } },
    { status: 400 },
  );
}
