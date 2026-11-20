import 'server-only';
import type { TablesInsert, TablesUpdate } from '@vrt/db';
import {
  DEFAULT_VIEWPORT,
  encryptSecret,
  projectSecretsSchema,
  slugify,
  viewportSchema,
  type createProjectRequest,
  type ProjectSettings,
} from '@vrt/shared';
import { CloudflareBucketAdmin, R2ObjectStore } from '@vrt/storage';
import type { z } from 'zod';
import { audit } from '../audit';
import { assertCan } from '../auth/assert-can';
import type { CurrentUser } from '../auth/session';
import { serverEnv } from '../env';
import { RequestError } from '../members/errors';
import { createClient } from '../supabase/server';
import { checkBucket, type BucketCheckResult } from './bucket-check';
import { SETTINGS_SELECT, rowToSettings, settingsToRow } from './columns';
import { FormError } from './form-result';
import { redactSecrets, settingsChanges } from './settings-audit';
import { validateSettingsGroup, type FormValues, type SettingsGroup } from './settings-groups';

type UserClient = Awaited<ReturnType<typeof createClient>>;

interface PostgrestLikeError {
  code?: string;
  message: string;
}

/** Maps database refusals (triggers, constraints) to user-facing errors. */
function dbError(what: string, error: PostgrestLikeError): Error {
  if (error.code === '23514' || error.code === 'P0001') {
    return new RequestError(422, 'business_rule', error.message);
  }
  if (error.code === '42501') return new RequestError(403, 'forbidden', error.message);
  return new Error(`Could not ${what}: ${error.message}`);
}

async function loadProject(supabase: UserClient, projectId: string) {
  const { data, error } = await supabase
    .from('projects_public')
    .select(`id, archived_at, has_basic_auth, ${SETTINGS_SELECT}`)
    .eq('id', projectId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the project: ${error.message}`);
  if (!data) throw new RequestError(404, 'not_found', 'Project not found');
  const row = data as unknown as Record<string, unknown> & {
    id: string;
    archived_at: string | null;
    has_basic_auth: boolean | null;
  };
  return {
    id: row.id,
    archivedAt: row.archived_at,
    hasBasicAuth: Boolean(row.has_basic_auth),
    settings: rowToSettings(row),
  };
}

/** Settings of an archived project are read-only (F-PROJ-6). */
async function loadEditable(supabase: UserClient, projectId: string) {
  const project = await loadProject(supabase, projectId);
  if (project.archivedAt) {
    throw new RequestError(422, 'business_rule', 'The project is archived; unarchive it first');
  }
  return project;
}

/** `base`, else `base-2`, `base-3`, … whichever is free. */
async function freeSlug(supabase: UserClient, base: string): Promise<string> {
  const { data, error } = await supabase
    .from('projects')
    .select('slug')
    .or(`slug.eq.${base},slug.like.${base}-%`);
  if (error) throw new Error(`Could not check the slug: ${error.message}`);
  const taken = new Set(data.map((row) => row.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base.slice(0, 63 - String(n).length - 1)}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * F-PROJ-1: platform admin creates a project with the default viewport; the creator becomes its
 * project admin. Without a slug one is generated from the name.
 */
export async function createProject(
  user: CurrentUser | null,
  input: z.output<typeof createProjectRequest>,
): Promise<{ projectId: string; slug: string }> {
  const actor = await assertCan(user, 'project.create', null);
  const supabase = await createClient();
  const { basicAuthPass, slug: requestedSlug, ...settings } = input;
  const slug = requestedSlug ?? (await freeSlug(supabase, slugify(settings.name) || 'project'));
  const basicAuthPassEnc = basicAuthPass
    ? await encryptSecret(basicAuthPass, serverEnv().SETTINGS_ENCRYPTION_KEY)
    : null;

  const { data: project, error } = await supabase
    .from('projects')
    .insert({
      ...(settingsToRow({ ...settings, slug }) as TablesInsert<'projects'>),
      basic_auth_pass_enc: basicAuthPassEnc,
      created_by: actor.id,
    })
    .select('id, slug')
    .single();
  if (error?.code === '23505') {
    throw new FormError({ slug: `The slug ${slug} is already taken` });
  }
  if (error) throw dbError('create the project', error);

  const { error: memberError } = await supabase
    .from('project_members')
    .insert({ project_id: project.id, user_id: actor.id, role: 'admin' });
  const { error: viewportError } = memberError
    ? { error: null }
    : await supabase.from('viewports').insert({
        project_id: project.id,
        slug: DEFAULT_VIEWPORT.slug,
        width: DEFAULT_VIEWPORT.width,
        height: DEFAULT_VIEWPORT.height,
        device_scale_factor: DEFAULT_VIEWPORT.deviceScaleFactor,
        is_mobile: DEFAULT_VIEWPORT.isMobile,
      });
  const setupError = memberError ?? viewportError;
  if (setupError) {
    // Without its admin or viewport the project is unusable; undo the insert.
    await supabase.from('projects').delete().eq('id', project.id);
    throw dbError('set up the project', setupError);
  }

  await audit(supabase, 'project.create', project.id, {
    settings: redactSecrets({ ...settings, slug, basicAuthPass }),
    viewport: DEFAULT_VIEWPORT.slug,
  });
  return { projectId: project.id, slug: project.slug };
}

/**
 * F-PROJ-3: saves one settings tab. Invalid values come back as field errors; every change is
 * audited with old and new values.
 */
export async function updateProjectSettings(
  user: CurrentUser | null,
  projectId: string,
  group: SettingsGroup,
  values: FormValues,
): Promise<{ slug: string; changed: number }> {
  await assertCan(user, 'project.settings', projectId);
  const validation = validateSettingsGroup(group, values);
  if (!validation.ok) throw new FormError(validation.fieldErrors);
  const supabase = await createClient();
  const project = await loadEditable(supabase, projectId);
  const changes = settingsChanges(project.settings, validation.data);
  const slug = validation.data.slug ?? project.settings.slug;
  if (Object.keys(changes).length === 0) return { slug, changed: 0 };

  const changed = Object.fromEntries(
    Object.keys(changes).map((field) => [field, validation.data[field as keyof ProjectSettings]]),
  ) as Partial<ProjectSettings>;
  const { error } = await supabase
    .from('projects')
    .update(settingsToRow(changed) as TablesUpdate<'projects'>)
    .eq('id', projectId);
  if (error?.code === '23505') throw new FormError({ slug: `The slug ${slug} is already taken` });
  if (error?.code === '23514' && changes.slug) throw new FormError({ slug: error.message });
  if (error) throw dbError('save the settings', error);
  await audit(supabase, 'project.settings.update', projectId, { group, changes });
  return { slug, changed: Object.keys(changes).length };
}

/**
 * Access tab password (03 §5): `string` replaces, `null` clears. Encrypted before it leaves the
 * server action; the plain value is never stored or audited.
 */
export async function setBasicAuthPassword(
  user: CurrentUser | null,
  projectId: string,
  password: string | null,
): Promise<void> {
  await assertCan(user, 'project.settings', projectId);
  const parsed = projectSecretsSchema.safeParse({ basicAuthPass: password });
  if (!parsed.success) throw new FormError({ basicAuthPass: 'Enter a password' });
  const supabase = await createClient();
  const project = await loadEditable(supabase, projectId);
  const value = parsed.data.basicAuthPass ?? null;
  const encrypted = value ? await encryptSecret(value, serverEnv().SETTINGS_ENCRYPTION_KEY) : null;
  const { error } = await supabase
    .from('projects')
    .update({ basic_auth_pass_enc: encrypted })
    .eq('id', projectId);
  if (error) throw dbError('save the password', error);
  await audit(supabase, 'project.settings.update', projectId, {
    group: 'access',
    changes: settingsChanges(
      { basicAuthPass: project.hasBasicAuth ? 'set' : null },
      { basicAuthPass: value },
    ),
  });
}

// Viewports (F-VIEWPORT-1) ----------------------------------------------------------------------

export type ViewportInput = z.input<typeof viewportSchema>;

function parseViewport(input: unknown) {
  const result = viewportSchema.omit({ sortOrder: true }).safeParse(input);
  if (!result.success) {
    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = String(issue.path[0] ?? 'form');
      errors[key] ??=
        issue.code === 'invalid_type' && issue.expected === 'number'
          ? 'Enter a number'
          : issue.message;
    }
    throw new FormError(errors);
  }
  return result.data;
}

function viewportRow(viewport: ReturnType<typeof parseViewport>) {
  return {
    slug: viewport.slug,
    width: viewport.width,
    height: viewport.height,
    device_scale_factor: viewport.deviceScaleFactor,
    is_mobile: viewport.isMobile,
    enabled: viewport.enabled,
  };
}

export async function createViewport(
  user: CurrentUser | null,
  projectId: string,
  input: unknown,
): Promise<void> {
  await assertCan(user, 'project.settings', projectId);
  const viewport = parseViewport(input);
  const supabase = await createClient();
  await loadEditable(supabase, projectId);
  const { data: last } = await supabase
    .from('viewports')
    .select('sort_order')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data, error } = await supabase
    .from('viewports')
    .insert({
      project_id: projectId,
      ...viewportRow(viewport),
      sort_order: (last?.sort_order ?? -1) + 1,
    })
    .select('id')
    .single();
  if (error?.code === '23505') {
    throw new FormError({ slug: `A viewport named ${viewport.slug} already exists` });
  }
  if (error) throw dbError('add the viewport', error);
  await audit(supabase, 'viewport.create', projectId, { viewport_id: data.id, ...viewport });
}

export async function updateViewport(
  user: CurrentUser | null,
  projectId: string,
  viewportId: string,
  input: unknown,
): Promise<void> {
  await assertCan(user, 'project.settings', projectId);
  const viewport = parseViewport(input);
  const supabase = await createClient();
  await loadEditable(supabase, projectId);
  const { data: before, error: loadError } = await supabase
    .from('viewports')
    .select('slug, width, height, device_scale_factor, is_mobile, enabled')
    .eq('id', viewportId)
    .eq('project_id', projectId)
    .maybeSingle();
  if (loadError) throw new Error(`Could not load the viewport: ${loadError.message}`);
  if (!before) throw new RequestError(404, 'not_found', 'Viewport not found');
  const { error } = await supabase
    .from('viewports')
    .update(viewportRow(viewport))
    .eq('id', viewportId)
    .eq('project_id', projectId);
  if (error?.code === '23505') {
    throw new FormError({ slug: `A viewport named ${viewport.slug} already exists` });
  }
  if (error?.code === '23514') throw new FormError({ slug: error.message });
  if (error) throw dbError('save the viewport', error);
  const after = viewportRow(viewport);
  await audit(supabase, 'viewport.update', projectId, {
    viewport_id: viewportId,
    changes: settingsChanges(
      { ...before, device_scale_factor: Number(before.device_scale_factor) },
      after,
    ),
  });
}

export async function deleteViewport(
  user: CurrentUser | null,
  projectId: string,
  viewportId: string,
): Promise<void> {
  await assertCan(user, 'project.settings', projectId);
  const supabase = await createClient();
  await loadEditable(supabase, projectId);
  const { count } = await supabase
    .from('viewports')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId);
  if ((count ?? 0) <= 1) {
    throw new RequestError(422, 'business_rule', 'A project needs at least one viewport');
  }
  const { data, error } = await supabase
    .from('viewports')
    .delete()
    .eq('id', viewportId)
    .eq('project_id', projectId)
    .select('slug');
  if (error) throw dbError('delete the viewport', error);
  if (data.length === 0) throw new RequestError(404, 'not_found', 'Viewport not found');
  await audit(supabase, 'viewport.delete', projectId, {
    viewport_id: viewportId,
    slug: data[0]!.slug,
  });
}

/** Moves a viewport one place up or down and renumbers `sort_order` 0..n-1. */
export async function moveViewport(
  user: CurrentUser | null,
  projectId: string,
  viewportId: string,
  direction: 'up' | 'down',
): Promise<void> {
  await assertCan(user, 'project.settings', projectId);
  const supabase = await createClient();
  await loadEditable(supabase, projectId);
  const { data, error } = await supabase
    .from('viewports')
    .select('id, slug')
    .eq('project_id', projectId)
    .order('sort_order')
    .order('created_at');
  if (error) throw new Error(`Could not load viewports: ${error.message}`);
  const order = data.map((row) => row.id);
  const index = order.indexOf(viewportId);
  if (index < 0) throw new RequestError(404, 'not_found', 'Viewport not found');
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= order.length) return;
  [order[index], order[target]] = [order[target]!, order[index]!];
  for (const [sortOrder, id] of order.entries()) {
    const { error: updateError } = await supabase
      .from('viewports')
      .update({ sort_order: sortOrder })
      .eq('id', id);
    if (updateError) throw dbError('reorder the viewports', updateError);
  }
  const slugs = new Map(data.map((row) => [row.id, row.slug]));
  await audit(supabase, 'viewport.reorder', projectId, {
    order: order.map((id) => slugs.get(id) ?? id),
  });
}

// Danger zone (F-PROJ-6) ------------------------------------------------------------------------

export async function setProjectArchived(
  user: CurrentUser | null,
  projectId: string,
  archived: boolean,
): Promise<void> {
  await assertCan(user, 'project.archive', projectId);
  const supabase = await createClient();
  await loadProject(supabase, projectId);
  const { error } = await supabase
    .from('projects')
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq('id', projectId);
  if (error) throw dbError(archived ? 'archive the project' : 'unarchive the project', error);
  await audit(supabase, archived ? 'project.archive' : 'project.unarchive', projectId, {});
}

// Storage (F-PROJ-5) ----------------------------------------------------------------------------

export async function runBucketCheck(
  user: CurrentUser | null,
  projectId: string,
  create: boolean,
): Promise<BucketCheckResult> {
  await assertCan(user, 'project.settings', projectId);
  const supabase = await createClient();
  const project = await loadProject(supabase, projectId);
  const env = serverEnv();
  const result = await checkBucket(
    {
      buckets: new CloudflareBucketAdmin({
        accountId: env.CF_ACCOUNT_ID,
        apiToken: env.CF_API_TOKEN,
      }),
      store: new R2ObjectStore({
        accountId: env.CF_ACCOUNT_ID,
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      }),
      fetch,
    },
    project.settings,
    { create },
  );
  await audit(supabase, 'project.bucket.check', projectId, {
    bucket: project.settings.r2Bucket,
    exists: result.exists,
    created: result.created,
    can_read_write_delete: result.canReadWriteDelete,
    public_url: result.publicUrl,
  });
  return result;
}
