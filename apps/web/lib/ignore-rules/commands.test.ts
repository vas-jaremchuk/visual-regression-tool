import type { IgnoreRuleValues, PermissionAction } from '@vrt/shared';
import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '../auth/assert-can';
import { RequestError } from '../members/errors';
import { createIgnoreRuleCommands, type IgnoreRulesGateway } from './commands';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const USER = '33333333-3333-4333-8333-333333333333';
const RULE = '44444444-4444-4444-8444-444444444444';

function setup(options: { role?: 'editor' | 'viewer'; archived?: boolean } = {}) {
  const state = {
    rules: new Map<string, IgnoreRuleValues & { createdBy: string }>(),
    audits: [] as { action: string; details: unknown }[],
    authorized: [] as PermissionAction[],
  };
  const db: IgnoreRulesGateway = {
    loadProject: async (id) =>
      id === PROJECT ? { id, archived: options.archived ?? false } : null,
    insertRule: async (_projectId, rule, createdBy) => {
      state.rules.set(RULE, { ...rule, createdBy });
      return { id: RULE };
    },
    updateRule: async (_projectId, id, patch) => {
      const rule = state.rules.get(id);
      if (!rule) return false;
      state.rules.set(id, { ...rule, ...patch });
      return true;
    },
    deleteRule: async (_projectId, id) => state.rules.delete(id),
    audit: async (action, _projectId, details) => {
      state.audits.push({ action, details });
    },
  };
  const commands = createIgnoreRuleCommands({
    authorize: async (action) => {
      state.authorized.push(action);
      if (options.role === 'viewer') throw new ForbiddenError(action);
    },
    db,
  });
  return { state, commands };
}

async function rejection(promise: Promise<unknown>): Promise<RequestError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(RequestError);
  return error as RequestError;
}

describe('ignore rule commands', () => {
  it('creates a region rule scoped to a URL and viewport, with author and audit', async () => {
    const { state, commands } = setup();
    const region = { x: 0, y: 0, width: 1280, height: 80 };
    await commands.create(PROJECT, USER, {
      type: 'region',
      urlPattern: 'https://www.example.com/',
      region,
      viewportSlug: 'desktop',
      selector: 'ignored for regions',
      appliesTo: 'capture',
      reason: ' header clock ',
    });
    expect(state.authorized).toEqual(['ignore_rule.manage']);
    expect(state.rules.get(RULE)).toEqual({
      type: 'region',
      url_pattern: 'https://www.example.com/',
      selector: null,
      region,
      viewport_slug: 'desktop',
      applies_to: 'both',
      enabled: true,
      reason: 'header clock',
      createdBy: USER,
    });
    expect(state.audits).toEqual([
      {
        action: 'ignore_rule.create',
        details: expect.objectContaining({ id: RULE, type: 'region', region }),
      },
    ]);
  });

  it('creates a selector rule for every URL when the pattern is empty', async () => {
    const { state, commands } = setup();
    await commands.create(PROJECT, USER, { type: 'selector', selector: '#chat', urlPattern: '' });
    expect(state.rules.get(RULE)).toMatchObject({
      type: 'selector',
      selector: '#chat',
      url_pattern: null,
      viewport_slug: null,
    });
  });

  it('rejects a rule without the field of its type or with an invalid regex', async () => {
    const { state, commands } = setup();
    for (const input of [
      { type: 'url_pattern' as const, urlPattern: '' },
      { type: 'selector' as const, selector: '  ' },
      { type: 'region' as const },
      { type: 'url_pattern' as const, urlPattern: 're:(' },
      { type: 'region' as const, region: { x: 0, y: 0, width: 0, height: 10 } },
    ]) {
      const error = await rejection(commands.create(PROJECT, USER, input));
      expect(error, JSON.stringify(input)).toMatchObject({ status: 400 });
    }
    expect(state.rules.size).toBe(0);
    expect(state.audits).toEqual([]);
  });

  it('refuses viewers and archived projects', async () => {
    const viewer = setup({ role: 'viewer' });
    await expect(
      viewer.commands.create(PROJECT, USER, { type: 'url_pattern', urlPattern: '**/cart' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const archived = setup({ archived: true });
    const error = await rejection(
      archived.commands.create(PROJECT, USER, { type: 'url_pattern', urlPattern: '**/cart' }),
    );
    expect(error).toMatchObject({ status: 422 });
  });

  it('updates, toggles and deletes a rule, auditing each change', async () => {
    const { state, commands } = setup();
    await commands.create(PROJECT, USER, { type: 'url_pattern', urlPattern: '**/cart' });
    await commands.update(PROJECT, RULE, {
      type: 'url_pattern',
      urlPattern: 're:/checkout',
      appliesTo: 'compare',
    });
    expect(state.rules.get(RULE)).toMatchObject({
      url_pattern: 're:/checkout',
      applies_to: 'compare',
    });
    await commands.setEnabled(PROJECT, RULE, false);
    expect(state.rules.get(RULE)!.enabled).toBe(false);
    await commands.remove(PROJECT, RULE);
    expect(state.rules.size).toBe(0);
    expect(state.audits.map((a) => a.action)).toEqual([
      'ignore_rule.create',
      'ignore_rule.update',
      'ignore_rule.update',
      'ignore_rule.delete',
    ]);
    expect(state.audits[2]!.details).toEqual({ id: RULE, enabled: false });
  });

  it('answers 404 for a rule that does not exist', async () => {
    const { commands } = setup();
    expect(await rejection(commands.setEnabled(PROJECT, RULE, true))).toMatchObject({
      status: 404,
    });
    expect(await rejection(commands.remove(PROJECT, RULE))).toMatchObject({ status: 404 });
  });
});
