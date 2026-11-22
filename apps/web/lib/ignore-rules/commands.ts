import type { Json } from '@vrt/db';
import {
  ignoreRuleInput,
  type IgnoreRuleInput,
  type IgnoreRuleValues,
  type PermissionAction,
} from '@vrt/shared';
import { RequestError } from '../members/errors';

/**
 * Ignore-rule commands (F-IGNORE-1, F-REVIEW-3). Pure orchestration over `IgnoreRulesGateway`, so
 * validation, permission and audit are tested without a database; `service.ts` wires it to
 * Supabase. Runs and comparisons snapshot the rules when they start (F-IGNORE-3), so a change
 * here never alters history.
 */

export interface IgnoreRulesGateway {
  loadProject(projectId: string): Promise<{ id: string; archived: boolean } | null>;
  insertRule(projectId: string, rule: IgnoreRuleValues, createdBy: string): Promise<{ id: string }>;
  /** Returns false when no rule with this id exists in the project. */
  updateRule(projectId: string, ruleId: string, patch: Partial<IgnoreRuleValues>): Promise<boolean>;
  deleteRule(projectId: string, ruleId: string): Promise<boolean>;
  audit(action: string, projectId: string, details: Record<string, Json>): Promise<void>;
}

export interface IgnoreRuleCommandDeps {
  /** Throws unless the user may do `action` in the project (`assertCan`). */
  authorize(action: PermissionAction, projectId: string): Promise<void>;
  db: IgnoreRulesGateway;
}

function parseRule(input: IgnoreRuleInput): IgnoreRuleValues {
  const result = ignoreRuleInput.safeParse(input);
  if (!result.success) {
    throw new RequestError(400, 'validation', result.error.issues[0]?.message ?? 'Invalid rule');
  }
  return result.data;
}

/** What the audit entry records of a rule: everything but the author. */
function describe(rule: Partial<IgnoreRuleValues>): Record<string, Json> {
  return Object.fromEntries(
    Object.entries(rule).filter(([, value]) => value !== undefined),
  ) as Record<string, Json>;
}

export function createIgnoreRuleCommands(deps: IgnoreRuleCommandDeps) {
  const { db } = deps;

  async function writable(projectId: string) {
    await deps.authorize('ignore_rule.manage', projectId);
    const project = await db.loadProject(projectId);
    if (!project) throw new RequestError(404, 'not_found', 'Project not found');
    if (project.archived) {
      throw new RequestError(422, 'business_rule', 'The project is archived; unarchive it first');
    }
  }

  function notFound(): never {
    throw new RequestError(404, 'not_found', 'Ignore rule not found');
  }

  return {
    async create(
      projectId: string,
      userId: string,
      input: IgnoreRuleInput,
    ): Promise<{ id: string }> {
      await writable(projectId);
      const rule = parseRule(input);
      const { id } = await db.insertRule(projectId, rule, userId);
      await db.audit('ignore_rule.create', projectId, { id, ...describe(rule) });
      return { id };
    },

    async update(projectId: string, ruleId: string, input: IgnoreRuleInput): Promise<void> {
      await writable(projectId);
      const rule = parseRule(input);
      if (!(await db.updateRule(projectId, ruleId, rule))) notFound();
      await db.audit('ignore_rule.update', projectId, { id: ruleId, ...describe(rule) });
    },

    async setEnabled(projectId: string, ruleId: string, enabled: boolean): Promise<void> {
      await writable(projectId);
      if (!(await db.updateRule(projectId, ruleId, { enabled }))) notFound();
      await db.audit('ignore_rule.update', projectId, { id: ruleId, enabled });
    },

    async remove(projectId: string, ruleId: string): Promise<void> {
      await writable(projectId);
      if (!(await db.deleteRule(projectId, ruleId))) notFound();
      await db.audit('ignore_rule.delete', projectId, { id: ruleId });
    },
  };
}
