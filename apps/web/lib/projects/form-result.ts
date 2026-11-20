import 'server-only';
import { describeError } from '../members/errors';
import type { FieldErrors } from './settings-groups';

/** Invalid form input, reported next to the fields (08 §4). */
export class FormError extends Error {
  constructor(readonly fieldErrors: FieldErrors) {
    super(Object.values(fieldErrors)[0] ?? 'Invalid input');
    this.name = 'FormError';
  }
}

export type FormResult<T = undefined> =
  | { ok: true; message: string; data?: T }
  | { ok: false; message: string; fieldErrors?: FieldErrors };

/** Like `runAction`, but keeps field errors for inline display and passes data back. */
export async function runFormAction<T = undefined>(
  success: string,
  action: () => Promise<{ message?: string; data?: T } | void>,
): Promise<FormResult<T>> {
  try {
    const result = await action();
    return { ok: true, message: result?.message ?? success, data: result?.data };
  } catch (error) {
    if (error instanceof FormError) {
      return { ok: false, message: 'Fix the highlighted fields', fieldErrors: error.fieldErrors };
    }
    return { ok: false, message: describeError(error).message };
  }
}
