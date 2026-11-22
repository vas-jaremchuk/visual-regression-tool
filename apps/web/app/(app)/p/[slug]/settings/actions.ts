'use server';

import { id } from '@vrt/shared';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth/session';
import { RequestError } from '@/lib/members/errors';
import type { BucketCheckResult } from '@/lib/projects/bucket-check';
import {
  createChannel,
  deleteChannel,
  testChannel,
  updateChannel,
} from '@/lib/notifications/service';
import { runFormAction, type FormResult } from '@/lib/projects/form-result';
import {
  createViewport,
  deleteViewport,
  moveViewport,
  runBucketCheck,
  setBasicAuthPassword,
  setProjectArchived,
  updateProjectSettings,
  updateViewport,
} from '@/lib/projects/service';
import { SETTINGS_GROUPS, type SettingsGroup } from '@/lib/projects/settings-groups';
import { deleteProject } from '@/lib/storage/service';

function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new RequestError(400, 'validation', result.error.issues[0]?.message ?? 'Invalid input');
  }
  return result.data;
}

const groupName = z.enum(Object.keys(SETTINGS_GROUPS) as [SettingsGroup, ...SettingsGroup[]]);
const formValues = z.record(z.string(), z.union([z.string().max(100_000), z.boolean()]));

function revalidateProject() {
  revalidatePath('/', 'layout');
}

/** Saves one settings tab (F-PROJ-3). Returns the slug so the page can follow a rename. */
export async function saveProjectSettings(input: {
  projectId: string;
  group: string;
  values: Record<string, string | boolean>;
}): Promise<FormResult<{ slug: string }>> {
  return runFormAction('Settings saved', async () => {
    const body = parse(z.object({ projectId: id, group: groupName, values: formValues }), input);
    const result = await updateProjectSettings(
      await getCurrentUser(),
      body.projectId,
      body.group,
      body.values,
    );
    revalidateProject();
    return {
      message: result.changed === 0 ? 'No changes to save' : 'Settings saved',
      data: { slug: result.slug },
    };
  });
}

/** Replaces (`password`) or clears (`null`) the basic auth password (03 §5). */
export async function saveBasicAuthPassword(input: {
  projectId: string;
  password: string | null;
}): Promise<FormResult> {
  return runFormAction(
    input.password === null ? 'Password cleared' : 'Password saved',
    async () => {
      const body = parse(
        z.object({ projectId: id, password: z.string().max(500).nullable() }),
        input,
      );
      await setBasicAuthPassword(await getCurrentUser(), body.projectId, body.password);
      revalidateProject();
    },
  );
}

export async function addViewport(input: {
  projectId: string;
  viewport: unknown;
}): Promise<FormResult> {
  return runFormAction('Viewport added', async () => {
    const body = parse(z.object({ projectId: id, viewport: z.unknown() }), input);
    await createViewport(await getCurrentUser(), body.projectId, body.viewport);
    revalidateProject();
  });
}

export async function editViewport(input: {
  projectId: string;
  viewportId: string;
  viewport: unknown;
}): Promise<FormResult> {
  return runFormAction('Viewport saved', async () => {
    const body = parse(z.object({ projectId: id, viewportId: id, viewport: z.unknown() }), input);
    await updateViewport(await getCurrentUser(), body.projectId, body.viewportId, body.viewport);
    revalidateProject();
  });
}

export async function removeViewport(input: {
  projectId: string;
  viewportId: string;
}): Promise<FormResult> {
  return runFormAction('Viewport deleted', async () => {
    const body = parse(z.object({ projectId: id, viewportId: id }), input);
    await deleteViewport(await getCurrentUser(), body.projectId, body.viewportId);
    revalidateProject();
  });
}

export async function reorderViewport(input: {
  projectId: string;
  viewportId: string;
  direction: 'up' | 'down';
}): Promise<FormResult> {
  return runFormAction('Viewport moved', async () => {
    const body = parse(
      z.object({ projectId: id, viewportId: id, direction: z.enum(['up', 'down']) }),
      input,
    );
    await moveViewport(await getCurrentUser(), body.projectId, body.viewportId, body.direction);
    revalidateProject();
  });
}

export async function archiveProject(input: {
  projectId: string;
  archived: boolean;
}): Promise<FormResult> {
  return runFormAction(input.archived ? 'Project archived' : 'Project unarchived', async () => {
    const body = parse(z.object({ projectId: id, archived: z.boolean() }), input);
    await setProjectArchived(await getCurrentUser(), body.projectId, body.archived);
    revalidateProject();
  });
}

/**
 * Delete project (F-PROJ-6, 03 §6): platform admin types the slug; R2 objects are deleted by the
 * DeleteWorkflow only when `deleteObjects` is ticked.
 */
export async function deleteProjectAction(input: {
  projectId: string;
  confirmSlug: string;
  deleteObjects: boolean;
}): Promise<FormResult<{ queued: boolean }>> {
  return runFormAction('Project deleted', async () => {
    const body = parse(
      z.object({ projectId: id, confirmSlug: z.string().max(200), deleteObjects: z.boolean() }),
      input,
    );
    const result = await deleteProject(await getCurrentUser(), body.projectId, body);
    revalidateProject();
    return {
      message: result.queued
        ? 'Deleting the project and its R2 objects; it is archived until the cleanup finishes.'
        : 'Project deleted',
      data: result,
    };
  });
}

/** *Check bucket* / *Create bucket* / *Test public URL* (F-PROJ-5). */
export async function checkProjectBucket(input: {
  projectId: string;
  create: boolean;
}): Promise<FormResult<BucketCheckResult>> {
  return runFormAction('Bucket checked', async () => {
    const body = parse(z.object({ projectId: id, create: z.boolean() }), input);
    const result = await runBucketCheck(await getCurrentUser(), body.projectId, body.create);
    return { message: result.error ?? 'Bucket checked', data: result };
  });
}

/** F-NOTIFY-1: adds an email or Slack channel. */
export async function addNotificationChannel(input: {
  projectId: string;
  channel: unknown;
}): Promise<FormResult> {
  return runFormAction('Channel added', async () => {
    const body = parse(z.object({ projectId: id, channel: z.unknown() }), input);
    await createChannel(await getCurrentUser(), body.projectId, body.channel);
    revalidateProject();
  });
}

export async function editNotificationChannel(input: {
  channelId: string;
  channel: unknown;
}): Promise<FormResult> {
  return runFormAction('Channel saved', async () => {
    const body = parse(z.object({ channelId: id, channel: z.unknown() }), input);
    await updateChannel(await getCurrentUser(), body.channelId, body.channel);
    revalidateProject();
  });
}

export async function removeNotificationChannel(input: { channelId: string }): Promise<FormResult> {
  return runFormAction('Channel deleted', async () => {
    const body = parse(z.object({ channelId: id }), input);
    await deleteChannel(await getCurrentUser(), body.channelId);
    revalidateProject();
  });
}

/** F-NOTIFY-2: sends a test message; the outcome also lands in the delivery log. */
export async function sendTestNotification(input: { channelId: string }): Promise<FormResult> {
  return runFormAction('Test sent', async () => {
    const body = parse(z.object({ channelId: id }), input);
    const result = await testChannel(await getCurrentUser(), body.channelId);
    revalidateProject();
    if (result.status === 'failed') {
      throw new RequestError(
        502,
        'delivery_failed',
        `Test failed: ${result.error ?? 'unknown error'}`,
      );
    }
  });
}
