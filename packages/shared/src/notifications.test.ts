import { describe, expect, it } from 'vitest';
import {
  deliverNotification,
  emailRecipients,
  noticeLink,
  notificationChannelInput,
  renderNotificationEmail,
  renderSlackMessage,
  slackWebhookUrl,
  withRetries,
  type ComparisonNotice,
  type NotificationLogEntry,
  type NotificationTransports,
} from './notifications';

const APP = 'https://vrt.example.test/';
const WEBHOOK = 'https://hooks.slack.com/services/T000/B000/secret';

const comparison: ComparisonNotice = {
  kind: 'comparison',
  event: 'comparison_changed',
  project: { name: 'Shop <b>', slug: 'shop' },
  comparison: { id: 'c1', label: 'cmp-1', beforeLabel: 'run-a', afterLabel: 'run-b' },
  counts: { changed: 7, new: 1, missing: 2, redirect: 3, filesChanged: 4 },
  topChanges: Array.from({ length: 7 }, (_, i) => ({
    url: `https://site.test/p${i}`,
    viewportSlug: 'desktop',
    diffPct: 10 - i,
  })),
};

const noSleep = { sleep: async () => {} };

function transports(fail: { email?: number; slack?: number } = {}) {
  const sent: { to: string; subject: string }[] = [];
  const posted: { url: string; text: string }[] = [];
  let emailFailures = fail.email ?? 0;
  let slackFailures = fail.slack ?? 0;
  const t: NotificationTransports = {
    async sendEmail(message) {
      if (emailFailures-- > 0) throw new Error('resend down');
      sent.push({ to: message.to, subject: message.subject });
    },
    async postSlack(url, message) {
      if (slackFailures-- > 0) throw new Error(`cannot reach ${url}`);
      posted.push({ url, text: message.text });
    },
  };
  return { t, sent, posted };
}

describe('message content (F-NOTIFY-3)', () => {
  it('links to the comparison report under APP_URL', () => {
    expect(noticeLink(comparison, APP)).toBe('https://vrt.example.test/p/shop/comparisons/c1');
  });

  it('email lists the pair, the counts and the top 5 changes, HTML escaped', () => {
    const email = renderNotificationEmail(comparison, APP);
    expect(email.subject).toBe('Shop <b>: changes found in cmp-1');
    expect(email.text).toContain('run-a → run-b');
    expect(email.text).toContain('Files changed: 4');
    expect(email.text).toContain('https://site.test/p4 (desktop): 6.00%');
    expect(email.text).not.toContain('https://site.test/p5');
    expect(email.text).toContain('Open: https://vrt.example.test/p/shop/comparisons/c1');
    expect(email.html).toContain('Shop &lt;b&gt;');
    expect(email.html).not.toContain('<b>:');
  });

  it('Slack uses Block Kit with a button to the report', () => {
    const slack = renderSlackMessage(comparison, APP);
    expect(slack.blocks[0]).toMatchObject({ type: 'header' });
    expect(slack.blocks.at(-1)).toMatchObject({
      type: 'actions',
      elements: [{ url: 'https://vrt.example.test/p/shop/comparisons/c1' }],
    });
    expect(slack.text).toBe(
      'Shop <b>: changes found in cmp-1: https://vrt.example.test/p/shop/comparisons/c1',
    );
  });
});

describe('channel input (F-NOTIFY-1)', () => {
  it('accepts only Slack incoming webhook URLs', () => {
    expect(slackWebhookUrl.safeParse(WEBHOOK).success).toBe(true);
    expect(slackWebhookUrl.safeParse('https://evil.test/services/x').success).toBe(false);
    expect(slackWebhookUrl.safeParse('http://hooks.slack.com/services/x').success).toBe(false);
  });

  it('needs at least one known event', () => {
    const base = { type: 'slack', webhookUrl: WEBHOOK, enabled: true };
    expect(notificationChannelInput.safeParse({ ...base, events: [] }).success).toBe(false);
    expect(notificationChannelInput.safeParse({ ...base, events: ['nope'] }).success).toBe(false);
    expect(
      notificationChannelInput.parse({ ...base, events: ['run_failed', 'run_failed'] }).events,
    ).toEqual(['run_failed']);
  });
});

describe('emailRecipients (F-NOTIFY-5)', () => {
  const members = [
    { email: 'a@test.local', muted: false },
    { email: 'B@test.local', muted: true },
  ];

  it('sends to every unmuted member when the channel has no address', () => {
    expect(emailRecipients(null, members)).toEqual(['a@test.local']);
  });

  it('drops an explicit address that belongs to a muted member', () => {
    expect(emailRecipients('b@test.local', members)).toEqual([]);
    expect(emailRecipients('team@test.local', members)).toEqual(['team@test.local']);
  });
});

describe('withRetries', () => {
  it('tries up to 3 times, then throws the last error', async () => {
    let calls = 0;
    await expect(
      withRetries(async () => {
        calls++;
        throw new Error(`fail ${calls}`);
      }, noSleep),
    ).rejects.toThrow('fail 3');
    expect(calls).toBe(3);
  });
});

describe('deliverNotification (F-NOTIFY-4)', () => {
  it('retries a failing Slack post and logs it sent', async () => {
    const { t, posted } = transports({ slack: 2 });
    const log: NotificationLogEntry[] = [];
    const entry = await deliverNotification(
      { id: 'ch1', type: 'slack', webhookUrl: WEBHOOK },
      comparison,
      'c1',
      { appUrl: APP, transports: t, log: async (e) => void log.push(e), retry: noSleep },
    );
    expect(posted).toHaveLength(1);
    expect(entry).toEqual({
      channelId: 'ch1',
      event: 'comparison_changed',
      entityId: 'c1',
      status: 'sent',
      error: null,
    });
    expect(log).toEqual([entry]);
  });

  it('logs a failure after 3 attempts without leaking the webhook URL', async () => {
    const { t } = transports({ slack: 5 });
    const entry = await deliverNotification(
      { id: 'ch1', type: 'slack', webhookUrl: WEBHOOK },
      { kind: 'test', project: { name: 'Shop', slug: 'shop' } },
      null,
      { appUrl: APP, transports: t, log: async () => {}, retry: noSleep },
    );
    expect(entry.status).toBe('failed');
    expect(entry.event).toBe('test');
    expect(entry.error).not.toContain('secret');
    expect(entry.error).toContain('[webhook]');
  });

  it('sends one email per recipient', async () => {
    const { t, sent } = transports();
    await deliverNotification(
      { id: 'ch2', type: 'email', recipients: ['a@test.local', 'c@test.local'] },
      comparison,
      'c1',
      { appUrl: APP, transports: t, log: async () => {}, retry: noSleep },
    );
    expect(sent.map((m) => m.to)).toEqual(['a@test.local', 'c@test.local']);
  });
});
