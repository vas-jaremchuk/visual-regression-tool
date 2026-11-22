import type { NotificationLogEntry, PermissionAction } from '@vrt/shared';
import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '../auth/assert-can';
import { FormError } from '../projects/form-result';
import {
  createNotificationCommands,
  type ChannelRecord,
  type ChannelWrite,
  type NotificationsGateway,
} from './commands';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const USER = '33333333-3333-4333-8333-333333333333';
const WEBHOOK = 'https://hooks.slack.com/services/T000/B000/secret';

function setup(options: { role?: 'admin' | 'viewer'; slackFails?: boolean } = {}) {
  const state = {
    channels: [] as (ChannelRecord & Partial<ChannelWrite>)[],
    log: [] as NotificationLogEntry[],
    audits: [] as { action: string; details: Record<string, unknown> }[],
    mutes: new Set<string>(),
    emails: [] as { to: string; subject: string; text: string }[],
    slack: [] as { url: string; text: string }[],
  };
  const db: NotificationsGateway = {
    loadChannel: async (id) => state.channels.find((c) => c.id === id) ?? null,
    loadProject: async () => ({ name: 'Shop', slug: 'shop', archived: false }),
    insertChannel: async (projectId, channel) => {
      const id = `ch-${state.channels.length + 1}`;
      state.channels.push({ id, projectId, ...channel });
      return id;
    },
    updateChannel: async (id, patch) => {
      Object.assign(
        state.channels.find((c) => c.id === id)!,
        patch,
      );
    },
    deleteChannel: async (id) => {
      state.channels = state.channels.filter((c) => c.id !== id);
    },
    log: async (entry) => void state.log.push(entry),
    setMute: async (userId, projectId, muted) => {
      if (muted) state.mutes.add(`${userId}:${projectId}`);
      else state.mutes.delete(`${userId}:${projectId}`);
    },
    audit: async (action, _projectId, details) => void state.audits.push({ action, details }),
  };
  const commands = createNotificationCommands({
    authorize: async (action: PermissionAction) => {
      if (action === 'project.settings' && options.role === 'viewer') {
        throw new ForbiddenError(action);
      }
    },
    db,
    encrypt: async (plaintext) => `enc(${plaintext})`,
    decrypt: async (payload) => payload.slice(4, -1),
    appUrl: 'https://vrt.test',
    transports: {
      sendEmail: async (message) => void state.emails.push(message),
      postSlack: async (url, message) => {
        if (options.slackFails) throw new Error(`404 from ${url}`);
        state.slack.push({ url, text: message.text });
      },
    },
    retry: { sleep: async () => {} },
  });
  return { state, commands };
}

const slack = { type: 'slack', webhookUrl: WEBHOOK, events: ['run_failed'], enabled: true };

describe('notification channels (F-NOTIFY-1)', () => {
  it('stores the Slack webhook URL encrypted and never audits it', async () => {
    const { state, commands } = setup();
    await commands.createChannel(PROJECT, slack);
    expect(state.channels[0]).toMatchObject({
      type: 'slack',
      target: null,
      targetEnc: `enc(${WEBHOOK})`,
    });
    expect(JSON.stringify(state.audits)).not.toContain('hooks.slack.com');
    expect(state.audits[0]).toMatchObject({
      action: 'notification_channel.create',
      details: { webhook_url: 'changed' },
    });
  });

  it('keeps the stored webhook when an edit leaves the URL blank', async () => {
    const { state, commands } = setup();
    const { channelId } = await commands.createChannel(PROJECT, slack);
    await commands.updateChannel(channelId, {
      ...slack,
      webhookUrl: '',
      events: ['run_completed'],
    });
    expect(state.channels[0]).toMatchObject({
      targetEnc: `enc(${WEBHOOK})`,
      events: ['run_completed'],
    });
  });

  it('requires the webhook URL for a new Slack channel and a valid address for email', async () => {
    const { commands } = setup();
    await expect(commands.createChannel(PROJECT, { ...slack, webhookUrl: '' })).rejects.toThrow(
      FormError,
    );
    await expect(
      commands.createChannel(PROJECT, {
        type: 'email',
        allMembers: false,
        target: 'nope',
        events: ['run_failed'],
        enabled: true,
      }),
    ).rejects.toMatchObject({ fieldErrors: { target: 'Enter an email address' } });
  });

  it('an email channel for all members has no address', async () => {
    const { state, commands } = setup();
    await commands.createChannel(PROJECT, {
      type: 'email',
      allMembers: true,
      target: 'ignored@test.local',
      events: ['comparison_changed'],
      enabled: true,
    });
    expect(state.channels[0]).toMatchObject({ type: 'email', target: null });
  });

  it('only project admins manage channels', async () => {
    const { commands } = setup({ role: 'viewer' });
    await expect(commands.createChannel(PROJECT, slack)).rejects.toThrow(ForbiddenError);
  });
});

describe('send test (F-NOTIFY-2)', () => {
  it('posts to Slack with the fake transport and logs the delivery', async () => {
    const { state, commands } = setup();
    const { channelId } = await commands.createChannel(PROJECT, slack);
    expect(await commands.testChannel(channelId, { email: 'admin@test.local' })).toEqual({
      status: 'sent',
      error: null,
    });
    expect(state.slack).toEqual([
      {
        url: WEBHOOK,
        text: 'Shop: test notification: https://vrt.test/p/shop/settings/notifications',
      },
    ]);
    expect(state.log).toEqual([
      { channelId, event: 'test', entityId: null, status: 'sent', error: null },
    ]);
  });

  it('reports a failed test without the webhook URL', async () => {
    const { state, commands } = setup({ slackFails: true });
    const { channelId } = await commands.createChannel(PROJECT, slack);
    const result = await commands.testChannel(channelId, { email: 'admin@test.local' });
    expect(result.status).toBe('failed');
    expect(result.error).not.toContain('secret');
    expect(state.log[0]!.status).toBe('failed');
  });

  it('a test of an all-members email channel goes to the requester only', async () => {
    const { state, commands } = setup();
    const { channelId } = await commands.createChannel(PROJECT, {
      type: 'email',
      allMembers: true,
      events: ['run_failed'],
      enabled: true,
    });
    await commands.testChannel(channelId, { email: 'admin@test.local' });
    expect(state.emails.map((m) => m.to)).toEqual(['admin@test.local']);
  });
});

describe('personal mute (F-NOTIFY-5)', () => {
  it('mutes and unmutes for the user and audits it', async () => {
    const { state, commands } = setup({ role: 'viewer' });
    await commands.setMute(USER, PROJECT, true);
    expect(state.mutes.has(`${USER}:${PROJECT}`)).toBe(true);
    await commands.setMute(USER, PROJECT, false);
    expect(state.mutes.size).toBe(0);
    expect(state.audits.map((a) => a.action)).toEqual(['notification.mute', 'notification.unmute']);
  });
});
