'use server';

import { id } from '@vrt/shared';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth/session';
import { runAction, type ActionResult } from '@/lib/members/action-result';
import { RequestError } from '@/lib/members/errors';
import { setProjectMute } from '@/lib/notifications/service';

/** F-NOTIFY-5: mutes (or unmutes) a project's email notifications for the signed-in user. */
export async function muteProject(input: {
  projectId: string;
  muted: boolean;
}): Promise<ActionResult> {
  return runAction(input.muted ? 'Project muted' : 'Project unmuted', async () => {
    const body = z.object({ projectId: id, muted: z.boolean() }).safeParse(input);
    if (!body.success) throw new RequestError(400, 'validation', 'Invalid input');
    await setProjectMute(await getCurrentUser(), body.data.projectId, body.data.muted);
    revalidatePath('/account');
  });
}
