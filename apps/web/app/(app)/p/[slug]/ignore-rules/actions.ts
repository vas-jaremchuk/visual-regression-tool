'use server';

import { id, type IgnoreRuleInput } from '@vrt/shared';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth/session';
import {
  createIgnoreRule,
  deleteIgnoreRule,
  setIgnoreRuleEnabled,
  updateIgnoreRule,
} from '@/lib/ignore-rules/service';
import { runAction, type ActionResult } from '@/lib/members/action-result';
import { RequestError } from '@/lib/members/errors';

function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new RequestError(400, 'validation', result.error.issues[0]?.message ?? 'Invalid input');
  }
  return result.data;
}

function revalidate() {
  revalidatePath('/p/[slug]/ignore-rules', 'page');
}

/** F-IGNORE-1 / F-REVIEW-3: adds an ignore rule (editor+). The rule body is validated in the command. */
export async function createIgnoreRuleAction(input: {
  projectId: string;
  rule: IgnoreRuleInput;
}): Promise<ActionResult> {
  return runAction('Ignore rule added', async () => {
    const body = parse(z.object({ projectId: id, rule: z.unknown() }), input);
    await createIgnoreRule(await getCurrentUser(), body.projectId, body.rule as IgnoreRuleInput);
    revalidate();
  });
}

/** F-IGNORE-1: edits an ignore rule (editor+). */
export async function updateIgnoreRuleAction(input: {
  projectId: string;
  id: string;
  rule: IgnoreRuleInput;
}): Promise<ActionResult> {
  return runAction('Ignore rule saved', async () => {
    const body = parse(z.object({ projectId: id, id, rule: z.unknown() }), input);
    await updateIgnoreRule(
      await getCurrentUser(),
      body.projectId,
      body.id,
      body.rule as IgnoreRuleInput,
    );
    revalidate();
  });
}

/** F-IGNORE-1: enables or disables an ignore rule (editor+). */
export async function setIgnoreRuleEnabledAction(input: {
  projectId: string;
  id: string;
  enabled: boolean;
}): Promise<ActionResult> {
  return runAction(input.enabled ? 'Rule enabled' : 'Rule disabled', async () => {
    const body = parse(z.object({ projectId: id, id, enabled: z.boolean() }), input);
    await setIgnoreRuleEnabled(await getCurrentUser(), body.projectId, body.id, body.enabled);
    revalidate();
  });
}

/** F-IGNORE-1: deletes an ignore rule (editor+). */
export async function deleteIgnoreRuleAction(input: {
  projectId: string;
  id: string;
}): Promise<ActionResult> {
  return runAction('Ignore rule deleted', async () => {
    const body = parse(z.object({ projectId: id, id }), input);
    await deleteIgnoreRule(await getCurrentUser(), body.projectId, body.id);
    revalidate();
  });
}
