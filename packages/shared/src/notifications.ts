import { z } from 'zod';
import { notificationEvent, type NotificationEvent } from './contracts/enums';

/**
 * Notifications (07 F-NOTIFY-1..5). Message rendering (email HTML + text, Slack Block Kit),
 * delivery with retries and the `notification_log` record, shared by the worker (capture and
 * compare finalise, 06 §2 step 4 / §5 step 9) and the web app (*Send test*, F-NOTIFY-2).
 * Transports and storage are injected; nothing here reads env or the database.
 */

/** Slack incoming webhook URL (F-NOTIFY-1). Only Slack's own host, so the URL cannot probe. */
export const slackWebhookUrl = z
  .string()
  .trim()
  .pipe(z.url({ error: 'Enter a Slack incoming webhook URL' }))
  .refine((value) => /^https:\/\/hooks\.slack\.com\/services\//.test(value), {
    error: 'Enter a Slack incoming webhook URL (https://hooks.slack.com/services/…)',
  });

const channelEvents = z
  .array(notificationEvent)
  .min(1, 'Choose at least one event')
  .transform((events) => [...new Set(events)]);

/**
 * Channel form (F-NOTIFY-1). An email channel without an address goes to every project member;
 * a Slack channel's webhook URL is required on create and optional on edit (blank keeps it).
 */
export const notificationChannelInput = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('email'),
    allMembers: z.boolean(),
    target: z.string().trim().max(320).optional(),
    events: channelEvents,
    enabled: z.boolean(),
  }),
  z.object({
    type: z.literal('slack'),
    webhookUrl: z.union([z.literal(''), slackWebhookUrl]).optional(),
    events: channelEvents,
    enabled: z.boolean(),
  }),
]);
export type NotificationChannelInput = z.infer<typeof notificationChannelInput>;

/** The email address of an email channel, or null for "all project members". */
export function emailChannelTarget(
  input: Extract<NotificationChannelInput, { type: 'email' }>,
): string | null {
  if (input.allMembers) return null;
  const parsed = z.email({ error: 'Enter an email address' }).safeParse(input.target ?? '');
  if (!parsed.success) throw new NotificationInputError('target', 'Enter an email address');
  return parsed.data;
}

export class NotificationInputError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = 'NotificationInputError';
  }
}

export const NOTIFICATION_EVENT_LABELS: Record<NotificationEvent, string> = {
  comparison_changed: 'Comparison with changes',
  comparison_clean: 'Comparison without changes',
  run_completed: 'Run completed',
  run_failed: 'Run failed',
};

/** Top changed URLs listed in a message (F-NOTIFY-3). */
export const NOTIFY_TOP_CHANGES = 5;

/** Attempts per delivery: the first try plus retries (F-NOTIFY-4). */
export const NOTIFY_ATTEMPTS = 3;

export interface ProjectRef {
  name: string;
  slug: string;
}

export interface ComparisonNotice {
  kind: 'comparison';
  event: 'comparison_changed' | 'comparison_clean';
  project: ProjectRef;
  comparison: { id: string; label: string; beforeLabel: string; afterLabel: string };
  counts: { changed: number; new: number; missing: number; redirect: number; filesChanged: number };
  /** Changed pages, largest difference first; at most `NOTIFY_TOP_CHANGES` are shown. */
  topChanges: { url: string; viewportSlug: string | null; diffPct: number | null }[];
}

export interface RunNotice {
  kind: 'run';
  event: 'run_completed' | 'run_failed';
  project: ProjectRef;
  run: { id: string; label: string; status: string };
  counts: { done: number; failed: number; skipped: number };
  error?: string | null;
}

export interface TestNotice {
  kind: 'test';
  project: ProjectRef;
}

export type Notice = ComparisonNotice | RunNotice | TestNotice;

/** `notification_log.event` of a notice; test sends log as `test`. */
export function noticeEvent(notice: Notice): NotificationEvent | 'test' {
  return notice.kind === 'test' ? 'test' : notice.event;
}

/** Link to the report, run or settings page in the web app. */
export function noticeLink(notice: Notice, appUrl: string): string {
  const base = `${appUrl.replace(/\/+$/, '')}/p/${encodeURIComponent(notice.project.slug)}`;
  switch (notice.kind) {
    case 'comparison':
      return `${base}/comparisons/${notice.comparison.id}`;
    case 'run':
      return `${base}/runs/${encodeURIComponent(notice.run.label)}`;
    case 'test':
      return `${base}/settings/notifications`;
  }
}

function headline(notice: Notice): string {
  const project = notice.project.name;
  switch (notice.kind) {
    case 'comparison':
      return notice.event === 'comparison_changed'
        ? `${project}: changes found in ${notice.comparison.label}`
        : `${project}: no changes in ${notice.comparison.label}`;
    case 'run':
      return notice.event === 'run_failed'
        ? `${project}: run ${notice.run.label} failed`
        : `${project}: run ${notice.run.label} ${notice.run.status.replaceAll('_', ' ')}`;
    case 'test':
      return `${project}: test notification`;
  }
}

function pct(value: number | null): string {
  return value === null ? 'n/a' : `${value.toFixed(2)}%`;
}

/** Plain lines shared by every format: summary, then counts, then top changes. */
function summary(notice: Notice): { intro: string; facts: [string, string][]; top: string[] } {
  switch (notice.kind) {
    case 'comparison': {
      const { comparison, counts } = notice;
      return {
        intro: `Comparison ${comparison.label}: ${comparison.beforeLabel} → ${comparison.afterLabel}`,
        facts: [
          ['Changed', String(counts.changed)],
          ['New', String(counts.new)],
          ['Missing', String(counts.missing)],
          ['Redirect', String(counts.redirect)],
          ['Files changed', String(counts.filesChanged)],
        ],
        top: notice.topChanges
          .slice(0, NOTIFY_TOP_CHANGES)
          .map(
            (change) =>
              `${change.url}${change.viewportSlug ? ` (${change.viewportSlug})` : ''}: ${pct(change.diffPct)}`,
          ),
      };
    }
    case 'run':
      return {
        intro: `Run ${notice.run.label} finished with status ${notice.run.status}.${
          notice.error ? ` Error: ${notice.error}` : ''
        }`,
        facts: [
          ['Done', String(notice.counts.done)],
          ['Failed', String(notice.counts.failed)],
          ['Skipped', String(notice.counts.skipped)],
        ],
        top: [],
      };
    case 'test':
      return {
        intro: 'This is a test notification. If you can read it, the channel works.',
        facts: [],
        top: [],
      };
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/** Email body, HTML and text (F-NOTIFY-3). */
export function renderNotificationEmail(notice: Notice, appUrl: string): RenderedEmail {
  const subject = headline(notice);
  const link = noticeLink(notice, appUrl);
  const { intro, facts, top } = summary(notice);
  const text = [
    subject,
    '',
    intro,
    ...(facts.length ? ['', ...facts.map(([label, value]) => `${label}: ${value}`)] : []),
    ...(top.length ? ['', 'Top changes:', ...top.map((line) => `- ${line}`)] : []),
    '',
    `Open: ${link}`,
  ].join('\n');
  const html = [
    '<!doctype html><html><body style="font-family:sans-serif;color:#111">',
    `<h1 style="font-size:18px">${escapeHtml(subject)}</h1>`,
    `<p>${escapeHtml(intro)}</p>`,
    facts.length
      ? `<table cellpadding="4">${facts
          .map(
            ([label, value]) =>
              `<tr><th align="left">${escapeHtml(label)}</th><td>${value}</td></tr>`,
          )
          .join('')}</table>`
      : '',
    top.length
      ? `<h2 style="font-size:15px">Top changes</h2><ul>${top
          .map((line) => `<li>${escapeHtml(line)}</li>`)
          .join('')}</ul>`
      : '',
    `<p><a href="${escapeHtml(link)}">Open in Visual Regression Tool</a></p>`,
    '</body></html>',
  ].join('');
  return { subject, text, html };
}

/** Escapes Slack mrkdwn control characters. */
function escapeSlack(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export interface SlackMessage {
  text: string;
  blocks: Record<string, unknown>[];
}

/** Slack Block Kit message (F-NOTIFY-3). `text` is the notification fallback. */
export function renderSlackMessage(notice: Notice, appUrl: string): SlackMessage {
  const title = headline(notice);
  const link = noticeLink(notice, appUrl);
  const { intro, facts, top } = summary(notice);
  const blocks: Record<string, unknown>[] = [
    { type: 'header', text: { type: 'plain_text', text: title.slice(0, 150) } },
    { type: 'section', text: { type: 'mrkdwn', text: escapeSlack(intro) } },
  ];
  if (facts.length) {
    blocks.push({
      type: 'section',
      fields: facts.map(([label, value]) => ({ type: 'mrkdwn', text: `*${label}*\n${value}` })),
    });
  }
  if (top.length) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Top changes*\n${top.map((line) => `• ${escapeSlack(line)}`).join('\n')}`,
      },
    });
  }
  blocks.push({
    type: 'actions',
    elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open' }, url: link }],
  });
  return { text: `${title}: ${link}`, blocks };
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Resend HTTP API (https://resend.com/docs/api-reference/emails/send-email). */
export async function sendResendEmail(
  fetchImpl: Fetch,
  config: { apiKey: string; from: string },
  message: RenderedEmail & { to: string },
): Promise<void> {
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: config.from, ...message }),
  });
  if (!response.ok) {
    throw new Error(`Resend rejected the email (${response.status}): ${await response.text()}`);
  }
}

/** Posts to a Slack incoming webhook. */
export async function postSlackWebhook(
  fetchImpl: Fetch,
  webhookUrl: string,
  message: SlackMessage,
): Promise<void> {
  const response = await fetchImpl(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(message),
    redirect: 'manual',
  });
  if (!response.ok) {
    // Slack's error body is a short code (e.g. `no_service`); never echo the URL.
    throw new Error(`Slack rejected the message (${response.status}): ${await response.text()}`);
  }
}

/** Runs `send` up to `attempts` times, waiting `delayMs × attempt` between tries. */
export async function withRetries(
  send: () => Promise<void>,
  options: { attempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<void> {
  const attempts = options.attempts ?? NOTIFY_ATTEMPTS;
  const delayMs = options.delayMs ?? 1_000;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await send();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(delayMs * attempt);
    }
  }
  throw lastError;
}

/** A channel ready to send: the Slack URL already decrypted, email recipients resolved. */
export type DeliverableChannel =
  | { id: string; type: 'email'; recipients: string[] }
  | { id: string; type: 'slack'; webhookUrl: string };

export interface NotificationLogEntry {
  channelId: string;
  event: NotificationEvent | 'test';
  entityId: string | null;
  status: 'sent' | 'failed';
  error: string | null;
}

export interface NotificationTransports {
  sendEmail(message: RenderedEmail & { to: string }): Promise<void>;
  postSlack(webhookUrl: string, message: SlackMessage): Promise<void>;
}

export interface DeliverOptions {
  appUrl: string;
  transports: NotificationTransports;
  log(entry: NotificationLogEntry): Promise<void>;
  retry?: Parameters<typeof withRetries>[1];
}

function errorText(error: unknown, secret?: string): string {
  let text = error instanceof Error ? error.message : String(error);
  if (secret) text = text.replaceAll(secret, '[webhook]');
  return text.slice(0, 1_000);
}

/**
 * Sends `notice` to one channel with retries and records the outcome in `notification_log`
 * (F-NOTIFY-4). Never throws for a delivery failure; returns the log entry instead. An email
 * channel with no recipient left (everyone muted) is logged as sent to nobody.
 */
export async function deliverNotification(
  channel: DeliverableChannel,
  notice: Notice,
  entityId: string | null,
  options: DeliverOptions,
): Promise<NotificationLogEntry> {
  const failures: string[] = [];
  if (channel.type === 'email') {
    const email = renderNotificationEmail(notice, options.appUrl);
    for (const to of channel.recipients) {
      try {
        await withRetries(() => options.transports.sendEmail({ ...email, to }), options.retry);
      } catch (error) {
        failures.push(`${to}: ${errorText(error)}`);
      }
    }
  } else {
    const message = renderSlackMessage(notice, options.appUrl);
    try {
      await withRetries(
        () => options.transports.postSlack(channel.webhookUrl, message),
        options.retry,
      );
    } catch (error) {
      failures.push(errorText(error, channel.webhookUrl));
    }
  }
  const entry: NotificationLogEntry = {
    channelId: channel.id,
    event: noticeEvent(notice),
    entityId,
    status: failures.length ? 'failed' : 'sent',
    error: failures.length ? failures.join('\n').slice(0, 2_000) : null,
  };
  await options.log(entry);
  return entry;
}

/**
 * Recipients of an email channel (F-NOTIFY-1, F-NOTIFY-5): its address, or every member when it
 * has none; muted members are dropped either way (matched by email, case-insensitive).
 */
export function emailRecipients(
  target: string | null,
  members: readonly { email: string; muted: boolean }[],
): string[] {
  const muted = new Set(members.filter((m) => m.muted).map((m) => m.email.toLowerCase()));
  const candidates = target === null ? members.map((m) => m.email) : [target];
  const seen = new Set<string>();
  return candidates.filter((email) => {
    const key = email.toLowerCase();
    if (muted.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
