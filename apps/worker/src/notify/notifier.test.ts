import type { NotificationLogEntry } from '@vrt/shared';
import { describe, expect, it } from 'vitest';
import { createProjectNotifier, type ChannelRow, type NotifyStore } from './notifier';

const PROJECT = 'p1';
const CMP = 'c1';
const WEBHOOK = 'https://hooks.slack.com/services/T/B/secret';

function setup(channels: (ChannelRow & { events: string[] })[], mutedEmails: string[] = []) {
  const log: NotificationLogEntry[] = [];
  const emails: { to: string; subject: string }[] = [];
  const slack: { url: string; text: string }[] = [];
  const store: NotifyStore = {
    loadProject: async () => ({ name: 'Shop', slug: 'shop' }),
    listChannels: async (_projectId, event) => channels.filter((c) => c.events.includes(event)),
    listMembers: async () =>
      ['alice@test.local', 'bob@test.local'].map((email) => ({
        email,
        muted: mutedEmails.includes(email),
      })),
    wasSent: async (channelId, event, entityId) =>
      log.some(
        (e) =>
          e.channelId === channelId &&
          e.event === event &&
          e.entityId === entityId &&
          e.status === 'sent',
      ),
    log: async (entry) => void log.push(entry),
    loadComparisonNotice: async () => ({
      comparison: { id: CMP, label: 'cmp', beforeLabel: 'a', afterLabel: 'b' },
      counts: { changed: 1, new: 0, missing: 0, redirect: 0, filesChanged: 0 },
      topChanges: [{ url: 'https://site.test/', viewportSlug: 'desktop', diffPct: 3 }],
    }),
    loadRunNotice: async () => ({
      run: { id: 'r1', label: 'run', status: 'failed' },
      counts: { done: 1, failed: 1, skipped: 0 },
    }),
  };
  const notifier = createProjectNotifier({
    store,
    decrypt: async (enc) =>
      enc === 'enc:webhook' ? WEBHOOK : Promise.reject(new Error('bad key')),
    appUrl: 'https://vrt.test',
    transports: {
      sendEmail: async (message) => void emails.push({ to: message.to, subject: message.subject }),
      postSlack: async (url, message) => void slack.push({ url, text: message.text }),
    },
    retry: { sleep: async () => {} },
  });
  return { notifier, log, emails, slack };
}

const allMembers = (events: string[]): ChannelRow & { events: string[] } => ({
  id: 'email-all',
  type: 'email',
  target: null,
  targetEnc: null,
  events,
});
const slackChannel = (events: string[]): ChannelRow & { events: string[] } => ({
  id: 'slack',
  type: 'slack',
  target: null,
  targetEnc: 'enc:webhook',
  events,
});

describe('project notifier', () => {
  it('sends to the channels subscribed to the event and logs each delivery', async () => {
    const { notifier, log, emails, slack } = setup([
      allMembers(['comparison_changed']),
      slackChannel(['comparison_clean']),
    ]);
    await notifier.comparison('comparison_changed', { projectId: PROJECT, comparisonId: CMP });
    expect(emails.map((e) => e.to)).toEqual(['alice@test.local', 'bob@test.local']);
    expect(emails[0]!.subject).toBe('Shop: changes found in cmp');
    expect(slack).toEqual([]);
    expect(log).toEqual([
      expect.objectContaining({
        channelId: 'email-all',
        event: 'comparison_changed',
        status: 'sent',
      }),
    ]);
  });

  it('a muted user receives no email (F-NOTIFY-5)', async () => {
    const { notifier, emails } = setup([allMembers(['run_failed'])], ['bob@test.local']);
    await notifier.run('run_failed', { projectId: PROJECT, runId: 'r1' });
    expect(emails.map((e) => e.to)).toEqual(['alice@test.local']);
  });

  it('decrypts the Slack webhook and posts Block Kit', async () => {
    const { notifier, slack } = setup([slackChannel(['comparison_clean'])]);
    await notifier.comparison('comparison_clean', { projectId: PROJECT, comparisonId: CMP });
    expect(slack).toEqual([
      { url: WEBHOOK, text: 'Shop: no changes in cmp: https://vrt.test/p/shop/comparisons/c1' },
    ]);
  });

  it('does not send twice when a workflow step replays', async () => {
    const { notifier, slack } = setup([slackChannel(['comparison_clean'])]);
    await notifier.comparison('comparison_clean', { projectId: PROJECT, comparisonId: CMP });
    await notifier.comparison('comparison_clean', { projectId: PROJECT, comparisonId: CMP });
    expect(slack).toHaveLength(1);
  });

  it('logs a channel it cannot prepare and never throws', async () => {
    const { notifier, log } = setup([{ ...slackChannel(['run_failed']), targetEnc: 'other' }]);
    await expect(
      notifier.run('run_failed', { projectId: PROJECT, runId: 'r1' }),
    ).resolves.toBeUndefined();
    expect(log).toEqual([expect.objectContaining({ status: 'failed', error: 'bad key' })]);
  });
});
