'use server';

import {
  createProjectRequest,
  importEnvRequest,
  importPrototypeEnv,
  type ImportEnvResponse,
} from '@vrt/shared';
import { revalidatePath } from 'next/cache';
import { assertCan } from '@/lib/auth/assert-can';
import { getCurrentUser } from '@/lib/auth/session';
import { RequestError } from '@/lib/members/errors';
import { FormError, runFormAction, type FormResult } from '@/lib/projects/form-result';
import { createProject } from '@/lib/projects/service';
import { fieldErrorsOf } from '@/lib/projects/settings-groups';

/** F-PROJ-1: create a project; returns its slug for the redirect. */
export async function createProjectAction(input: unknown): Promise<FormResult<{ slug: string }>> {
  return runFormAction('Project created', async () => {
    const body = createProjectRequest.safeParse(input);
    if (!body.success) throw new FormError(fieldErrorsOf(body.error));
    const result = await createProject(await getCurrentUser(), body.data);
    revalidatePath('/', 'layout');
    return { data: { slug: result.slug } };
  });
}

/** F-PROJ-4: prototype `.env` text → preview. Nothing is written. */
export async function previewEnvImport(text: string): Promise<FormResult<ImportEnvResponse>> {
  return runFormAction('Parsed', async () => {
    const body = importEnvRequest.safeParse({ text });
    if (!body.success) throw new RequestError(400, 'validation', 'The text is too long');
    await assertCan(await getCurrentUser(), 'project.create', null);
    return { data: importPrototypeEnv(body.data.text) };
  });
}
