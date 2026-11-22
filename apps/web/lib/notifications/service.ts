import 'server-only';
import { decryptSecret, encryptSecret, postSlackWebhook } from '@vrt/shared';
import { audit } from '../audit';
import { ForbiddenError, assertCan } from '../auth/assert-can';
import type { CurrentUser } from '../auth/session';
import { emailSender } from '../email';
import { serverEnv } from '../env';
import { RequestError } from '../members/errors';
import { createAdminClient } from '../supabase/admin';
import { createClient } from '../supabase/server';
import { createNotificationCommands, type NotificationsGateway } from './commands';

type UserClient = Awaited<ReturnType<typeof createClient>>;

function check(what: string, result: { error: { message: string; code?: string } | null }) {
  if (!result.error) return;
  if (result.error.code === '42501') throw new RequestError(403, 'forbidden', result.error.message);
  throw new Error(`Could not ${what}: ${result.error.message}`);
}

function supabaseGateway(supabase: UserClient): NotificationsGateway {
  return {
    async loadChannel(channelId) {
      // The user client cannot read `target_enc`; the service role reads it only after
      // `authorize` checked the caller, and it never leaves the server.
      const { data, error } = await createAdminClient()
        .from('notification_channels')
        .select('id, project_id, type, target, target_enc')
        .eq('id', channelId)
        .maybeSingle();
      if (error) throw new Error(`Could not load the channel: ${error.message}`);
      if (!data) return null;
      return {
        id: data.id,
        projectId: data.project_id,
        type: data.type,
        target: data.target,
        targetEnc: data.target_enc,
      };
    },

    async loadProject(projectId) {
      const { data, error } = await supabase
        .from('projects_public')
        .select('name, slug, archived_at')
        .eq('id', projectId)
        .maybeSingle();
      if (error) throw new Error(`Could not load the project: ${error.message}`);
      if (!data) throw new RequestError(404, 'not_found', 'Project not found');
      return { name: data.name!, slug: data.slug!, archived: data.archived_at !== null };
    },

    async insertChannel(projectId, channel) {
      const { data, error } = await supabase
        .from('notification_channels')
        .insert({
          project_id: projectId,
          type: channel.type,
          target: channel.target,
          target_enc: channel.targetEnc,
          events: channel.events,
          enabled: channel.enabled,
        })
        .select('id')
        .single();
      check('add the channel', { error });
      return data!.id;
    },

    async updateChannel(channelId, patch) {
      check(
        'update the channel',
        await supabase
          .from('notification_channels')
          .update({
            ...(patch.target !== undefined ? { target: patch.target } : {}),
            ...(patch.targetEnc !== undefined ? { target_enc: patch.targetEnc } : {}),
            ...(patch.events ? { events: patch.events } : {}),
            ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
          })
          .eq('id', channelId),
      );
    },

    async deleteChannel(channelId) {
      check(
        'delete the channel',
        await supabase.from('notification_channels').delete().eq('id', channelId),
      );
    },

    async log(entry) {
      // notification_log is written by the service only (02 §4).
      check(
        'write the notification log',
        await createAdminClient()
          .from('notification_log')
          .insert({
            channel_id: entry.channelId,
            event: entry.event,
            entity_id: entry.entityId,
            status: entry.status,
            error: entry.error,
            sent_at: entry.status === 'sent' ? new Date().toISOString() : null,
          }),
      );
    },

    async setMute(userId, projectId, muted) {
      if (muted) {
        check(
          'mute the project',
          await supabase
            .from('notification_mutes')
            .upsert({ user_id: userId, project_id: projectId }, { ignoreDuplicates: true }),
        );
      } else {
        check(
          'unmute the project',
          await supabase
            .from('notification_mutes')
            .delete()
            .eq('user_id', userId)
            .eq('project_id', projectId),
        );
      }
    },

    audit: (action, projectId, details) => audit(supabase, action, projectId, details),
  };
}

async function commands(user: CurrentUser | null) {
  if (!user) throw new ForbiddenError('project.settings');
  const env = serverEnv();
  const supabase = await createClient();
  const email = emailSender();
  return createNotificationCommands({
    authorize: async (action, projectId) => {
      await assertCan(user, action, projectId);
    },
    db: supabaseGateway(supabase),
    encrypt: (plaintext) => encryptSecret(plaintext, env.SETTINGS_ENCRYPTION_KEY),
    decrypt: (payload) => decryptSecret(payload, env.SETTINGS_ENCRYPTION_KEY),
    appUrl: env.APP_URL,
    transports: {
      sendEmail: (message) => email.send(message),
      postSlack: (webhookUrl, message) => postSlackWebhook(fetch, webhookUrl, message),
    },
  });
}

export async function createChannel(user: CurrentUser | null, projectId: string, input: unknown) {
  return (await commands(user)).createChannel(projectId, input);
}

export async function updateChannel(user: CurrentUser | null, channelId: string, input: unknown) {
  return (await commands(user)).updateChannel(channelId, input);
}

export async function deleteChannel(user: CurrentUser | null, channelId: string) {
  return (await commands(user)).deleteChannel(channelId);
}

/** F-NOTIFY-2: project admin sends a test message through a channel. */
export async function testChannel(user: CurrentUser | null, channelId: string) {
  return (await commands(user)).testChannel(channelId, { email: user!.email });
}

export async function setProjectMute(user: CurrentUser | null, projectId: string, muted: boolean) {
  return (await commands(user)).setMute(user!.id, projectId, muted);
}
