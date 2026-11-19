import 'server-only';
import { describeError } from './errors';

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

/**
 * Runs a mutating server action and reports its outcome for a toast (08 §4). The action may
 * return a message that replaces `success`.
 */
export async function runAction(
  success: string,
  action: () => Promise<string | void>,
): Promise<ActionResult> {
  try {
    return { ok: true, message: (await action()) ?? success };
  } catch (error) {
    return { ok: false, message: describeError(error).message };
  }
}
