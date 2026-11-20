'use server';

import { id } from '@vrt/shared';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth/session';
import { runAction, type ActionResult } from '@/lib/members/action-result';
import { RequestError } from '@/lib/members/errors';
import { addManualUrl, removeManualUrl } from '@/lib/sitemap/service';

function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new RequestError(400, 'validation', result.error.issues[0]?.message ?? 'Invalid input');
  }
  return result.data;
}

/** F-SITEMAP-4: adds a manual URL (editor+). */
export async function addManualUrlAction(input: {
  projectId: string;
  url: string;
  note?: string;
}): Promise<ActionResult> {
  return runAction('URL added', async () => {
    const body = parse(
      z.object({ projectId: id, url: z.string().trim(), note: z.string().optional() }),
      input,
    );
    await addManualUrl(await getCurrentUser(), body.projectId, { url: body.url, note: body.note });
    revalidatePath('/p/[slug]/sitemap', 'page');
  });
}

/** F-SITEMAP-4: removes a manual URL (editor+). */
export async function removeManualUrlAction(input: {
  projectId: string;
  id: string;
}): Promise<ActionResult> {
  return runAction('URL removed', async () => {
    const body = parse(z.object({ projectId: id, id }), input);
    await removeManualUrl(await getCurrentUser(), body.projectId, body.id);
    revalidatePath('/p/[slug]/sitemap', 'page');
  });
}
