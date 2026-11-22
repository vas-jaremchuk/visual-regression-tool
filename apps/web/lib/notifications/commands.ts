import type { Json } from '@vrt/db';
import {
  deliverNotification,
  emailChannelTarget,
  NotificationInputError,
  notificationChannelInput,
  type ChannelType,
  type NotificationEvent,
  type NotificationLogEntry,
  type NotificationTransports,
  type PermissionAction,
} from '@vrt/shared';
import { RequestError } from '../members/errors';
import { FormError } from '../projects/form-result';

/**
 * Notification channel commands (07 F-NOTIFY-1/2/4/5). Pure orchestration over
 * `NotificationsGateway`, so the rules (the Slack webhook URL is encrypted and never returned,
 * test sends are logged, mutes are personal) are tested without a database; `service.ts` wires
 * the gateway to Supabase, the encryption key and the transports.
 */

export interface ChannelRecord {
  id: string;
  projectId: string;
  type: ChannelType;
  target: string | null;
  /** Encrypted Slack webhook URL; read with the service role, never sent to the browser. */
  targetEnc: string | null;
}

export interface ChannelWrite {
  type: ChannelType;
  target: string | null;
  targetEnc: string | null;
  events: NotificationEvent[];
  enabled: boolean;
}

export interface NotificationsGateway {
  loadChannel(channelId: string): Promise<ChannelRecord | null>;
  loadProject(projectId: string): Promise<{ name: string; slug: string; archived: boolean }>;
  insertChannel(projectId: string, channel: ChannelWrite): Promise<string>;
  updateChannel(channelId: string, patch: Partial<ChannelWrite>): Promise<void>;
  deleteChannel(channelId: string): Promise<void>;
  log(entry: NotificationLogEntry): Promise<void>;
  setMute(userId: string, projectId: string, muted: boolean): Promise<void>;
  audit(action: string, projectId: string, details: Record<string, Json>): Promise<void>;
}

export interface NotificationCommandDeps {
  authorize(action: PermissionAction, projectId: string): Promise<void>;
  db: NotificationsGateway;
  encrypt(plaintext: string): Promise<string>;
  decrypt(payload: string): Promise<string>;
  appUrl: string;
  transports: NotificationTransports;
  retry?: Parameters<typeof deliverNotification>[3]['retry'];
}

function parseInput(input: unknown) {
  const result = notificationChannelInput.safeParse(input);
  if (result.success) return result.data;
  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? 'form');
    fieldErrors[key] ??= issue.message;
  }
  throw new FormError(fieldErrors);
}

function auditDetails(channelId: string, write: Partial<ChannelWrite>): Record<string, Json> {
  // The webhook URL is a secret: only whether it changed is audited.
  const { targetEnc, ...rest } = write;
  return {
    channel_id: channelId,
    ...(rest as Record<string, Json>),
    ...(targetEnc !== undefined ? { webhook_url: 'changed' } : {}),
  };
}

export function createNotificationCommands(deps: NotificationCommandDeps) {
  const { db } = deps;

  async function editable(projectId: string) {
    await deps.authorize('project.settings', projectId);
    const project = await db.loadProject(projectId);
    if (project.archived) {
      throw new RequestError(422, 'business_rule', 'The project is archived and read-only');
    }
    return project;
  }

  async function channelOf(channelId: string) {
    const channel = await db.loadChannel(channelId);
    if (!channel) throw new RequestError(404, 'not_found', 'Channel not found');
    return channel;
  }

  async function toWrite(input: unknown, existing?: ChannelRecord): Promise<Partial<ChannelWrite>> {
    const parsed = parseInput(input);
    if (existing && existing.type !== parsed.type) {
      throw new FormError({ type: 'The channel type cannot change' });
    }
    if (parsed.type === 'email') {
      try {
        return {
          type: 'email',
          target: emailChannelTarget(parsed),
          targetEnc: null,
          events: parsed.events,
          enabled: parsed.enabled,
        };
      } catch (error) {
        if (error instanceof NotificationInputError) {
          throw new FormError({ [error.field]: error.message });
        }
        throw error;
      }
    }
    const url = parsed.webhookUrl || null;
    if (!url && !existing) {
      throw new FormError({ webhookUrl: 'Enter a Slack incoming webhook URL' });
    }
    return {
      type: 'slack',
      target: null,
      ...(url ? { targetEnc: await deps.encrypt(url) } : {}),
      events: parsed.events,
      enabled: parsed.enabled,
    };
  }

  return {
    /** F-NOTIFY-1: project admin adds an email or Slack channel. */
    async createChannel(projectId: string, input: unknown): Promise<{ channelId: string }> {
      await editable(projectId);
      const write = (await toWrite(input)) as ChannelWrite;
      const channelId = await db.insertChannel(projectId, write);
      await db.audit('notification_channel.create', projectId, auditDetails(channelId, write));
      return { channelId };
    },

    /** A blank webhook URL keeps the stored one. */
    async updateChannel(channelId: string, input: unknown): Promise<void> {
      const channel = await channelOf(channelId);
      await editable(channel.projectId);
      const write = await toWrite(input, channel);
      await db.updateChannel(channelId, write);
      await db.audit(
        'notification_channel.update',
        channel.projectId,
        auditDetails(channelId, write),
      );
    },

    async deleteChannel(channelId: string): Promise<void> {
      const channel = await channelOf(channelId);
      await editable(channel.projectId);
      await db.deleteChannel(channelId);
      await db.audit('notification_channel.delete', channel.projectId, {
        channel_id: channelId,
        type: channel.type,
      });
    },

    /**
     * F-NOTIFY-2: sends a test message and logs it (F-NOTIFY-4). An email channel for all
     * members sends the test to the requesting admin only, so a test does not mail everyone.
     */
    async testChannel(
      channelId: string,
      requester: { email: string },
    ): Promise<{ status: 'sent' | 'failed'; error: string | null }> {
      const channel = await channelOf(channelId);
      await deps.authorize('project.settings', channel.projectId);
      const project = await db.loadProject(channel.projectId);
      let entry: NotificationLogEntry;
      const notice = { kind: 'test', project: { name: project.name, slug: project.slug } } as const;
      const options = {
        appUrl: deps.appUrl,
        transports: deps.transports,
        log: (row: NotificationLogEntry) => db.log(row),
        retry: deps.retry,
      };
      if (channel.type === 'email') {
        entry = await deliverNotification(
          { id: channel.id, type: 'email', recipients: [channel.target ?? requester.email] },
          notice,
          null,
          options,
        );
      } else {
        if (!channel.targetEnc) {
          throw new RequestError(422, 'business_rule', 'The channel has no webhook URL');
        }
        entry = await deliverNotification(
          { id: channel.id, type: 'slack', webhookUrl: await deps.decrypt(channel.targetEnc) },
          notice,
          null,
          options,
        );
      }
      await db.audit('notification_channel.test', channel.projectId, {
        channel_id: channelId,
        status: entry.status,
      });
      return { status: entry.status, error: entry.error };
    },

    /** F-NOTIFY-5: the signed-in user mutes (or unmutes) a project's emails for themselves. */
    async setMute(userId: string, projectId: string, muted: boolean): Promise<void> {
      await deps.authorize('project.view', projectId);
      await db.setMute(userId, projectId, muted);
      await db.audit(muted ? 'notification.mute' : 'notification.unmute', projectId, {});
    },
  };
}

export type NotificationCommands = ReturnType<typeof createNotificationCommands>;
