import 'server-only';
import { audit } from '../audit';
import { assertCan, ForbiddenError } from '../auth/assert-can';
import type { CurrentUser } from '../auth/session';
import { RequestError } from '../members/errors';
import { createClient } from '../supabase/server';
import { workerClient } from '../worker-client';
import {
  createComparisonCommands,
  type ComparisonsGateway,
  type StartComparisonInput,
} from './commands';

type UserClient = Awaited<ReturnType<typeof createClient>>;

function check<T>(what: string, result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(`Could not ${what}: ${result.error.message}`);
  return result.data;
}

/** `ComparisonsGateway` as the signed-in user: every read and write goes through RLS. */
function supabaseGateway(supabase: UserClient): ComparisonsGateway {
  return {
    async loadProject(projectId) {
      const row = check(
        'load the project',
        await supabase
          .from('projects_public')
          .select('id, slug, archived_at')
          .eq('id', projectId)
          .maybeSingle(),
      );
      if (!row?.id) return null;
      return { id: row.id, slug: row.slug!, archived: row.archived_at !== null };
    },

    async loadRun(runId) {
      const row = check(
        'load the run',
        await supabase
          .from('runs')
          .select('id, project_id, label, status, created_at')
          .eq('id', runId)
          .maybeSingle(),
      );
      if (!row) return null;
      return {
        id: row.id,
        projectId: row.project_id,
        label: row.label,
        status: row.status,
        createdAt: row.created_at,
      };
    },

    async findComparison(projectId, beforeRunId, afterRunId) {
      return check(
        'load the comparison',
        await supabase
          .from('comparisons')
          .select('id, label, status')
          .eq('project_id', projectId)
          .eq('before_run_id', beforeRunId)
          .eq('after_run_id', afterRunId)
          .maybeSingle(),
      );
    },

    async insertComparison(comparison) {
      const { data, error } = await supabase
        .from('comparisons')
        .insert({
          project_id: comparison.projectId,
          before_run_id: comparison.beforeRunId,
          after_run_id: comparison.afterRunId,
          label: comparison.label,
          status: 'queued',
          started_by: comparison.startedBy,
        })
        .select('id')
        .single();
      if (error?.code === '23505') {
        throw new RequestError(409, 'conflict', 'These runs are being compared already');
      }
      if (error?.code === '42501') throw new RequestError(403, 'forbidden', error.message);
      if (error) throw new Error(`Could not create the comparison: ${error.message}`);
      return data;
    },

    async updateComparison(comparisonId, patch) {
      check(
        'update the comparison',
        await supabase.from('comparisons').update(patch).eq('id', comparisonId),
      );
    },

    audit: (action, projectId, details) => audit(supabase, action, projectId, details),
  };
}

/** F-CMP-1: editor+ compares two completed runs (or, confirmed, re-runs the same pair). */
export async function startComparison(
  user: CurrentUser | null,
  projectId: string,
  input: StartComparisonInput,
): Promise<{ comparisonId: string; label: string }> {
  if (!user) throw new ForbiddenError('comparison.start');
  const supabase = await createClient();
  const commands = createComparisonCommands({
    authorize: async (action, id) => {
      await assertCan(user, action, id);
    },
    db: supabaseGateway(supabase),
    worker: workerClient(),
  });
  return commands.startComparison(projectId, user.id, input);
}
