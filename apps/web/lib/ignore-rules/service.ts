import 'server-only';
import type { Json } from '@vrt/db';
import type { IgnoreRuleInput } from '@vrt/shared';
import { audit } from '../audit';
import { assertCan, ForbiddenError } from '../auth/assert-can';
import type { CurrentUser } from '../auth/session';
import { RequestError } from '../members/errors';
import { createClient } from '../supabase/server';
import { createIgnoreRuleCommands, type IgnoreRulesGateway } from './commands';

type UserClient = Awaited<ReturnType<typeof createClient>>;

function fail(what: string, error: { code?: string; message: string }): never {
  if (error.code === '42501') throw new RequestError(403, 'forbidden', error.message);
  throw new Error(`Could not ${what}: ${error.message}`);
}

/** `IgnoreRulesGateway` as the signed-in user: RLS allows writes for `can_edit` (02 §4). */
function supabaseGateway(supabase: UserClient): IgnoreRulesGateway {
  return {
    async loadProject(projectId) {
      const { data, error } = await supabase
        .from('projects_public')
        .select('id, archived_at')
        .eq('id', projectId)
        .maybeSingle();
      if (error) fail('load the project', error);
      return data?.id ? { id: data.id, archived: data.archived_at !== null } : null;
    },

    async insertRule(projectId, rule, createdBy) {
      const { data, error } = await supabase
        .from('ignore_rules')
        .insert({
          ...rule,
          region: rule.region as Json,
          project_id: projectId,
          created_by: createdBy,
        })
        .select('id')
        .single();
      if (error) fail('create the ignore rule', error);
      return data;
    },

    async updateRule(projectId, ruleId, patch) {
      const { region, ...rest } = patch;
      const { data, error } = await supabase
        .from('ignore_rules')
        .update(region === undefined ? rest : { ...rest, region: region as Json })
        .eq('project_id', projectId)
        .eq('id', ruleId)
        .select('id');
      if (error) fail('update the ignore rule', error);
      return data.length > 0;
    },

    async deleteRule(projectId, ruleId) {
      const { data, error } = await supabase
        .from('ignore_rules')
        .delete()
        .eq('project_id', projectId)
        .eq('id', ruleId)
        .select('id');
      if (error) fail('delete the ignore rule', error);
      return data.length > 0;
    },

    audit: (action, projectId, details) => audit(supabase, action, projectId, details),
  };
}

async function commands(user: CurrentUser | null) {
  if (!user) throw new ForbiddenError('ignore_rule.manage');
  return createIgnoreRuleCommands({
    authorize: async (action, projectId) => {
      await assertCan(user, action, projectId);
    },
    db: supabaseGateway(await createClient()),
  });
}

/** F-IGNORE-1 / F-REVIEW-3: editor+ adds a rule. */
export async function createIgnoreRule(
  user: CurrentUser | null,
  projectId: string,
  input: IgnoreRuleInput,
): Promise<{ id: string }> {
  return (await commands(user)).create(projectId, user!.id, input);
}

/** F-IGNORE-1: editor+ edits a rule. */
export async function updateIgnoreRule(
  user: CurrentUser | null,
  projectId: string,
  ruleId: string,
  input: IgnoreRuleInput,
): Promise<void> {
  return (await commands(user)).update(projectId, ruleId, input);
}

/** F-IGNORE-1: editor+ enables or disables a rule. */
export async function setIgnoreRuleEnabled(
  user: CurrentUser | null,
  projectId: string,
  ruleId: string,
  enabled: boolean,
): Promise<void> {
  return (await commands(user)).setEnabled(projectId, ruleId, enabled);
}

/** F-IGNORE-1: editor+ deletes a rule. */
export async function deleteIgnoreRule(
  user: CurrentUser | null,
  projectId: string,
  ruleId: string,
): Promise<void> {
  return (await commands(user)).remove(projectId, ruleId);
}
