import 'server-only';
import type { ChannelType, NotificationEvent } from '@vrt/shared';
import { createClient } from '../supabase/server';

/** A channel as the settings page sees it: never the (encrypted) Slack webhook URL. */
export interface ChannelView {
  id: string;
  type: ChannelType;
  /** Email address, or null for all project members (email) / hidden webhook (Slack). */
  target: string | null;
  events: NotificationEvent[];
  enabled: boolean;
}

export interface DeliveryView {
  id: string;
  channelId: string;
  event: string;
  status: string;
  error: string | null;
  createdAt: string;
}

/** Recent deliveries per channel shown in settings (F-NOTIFY-4). */
const LOG_LIMIT = 50;

export async function listChannels(
  projectId: string,
): Promise<{ channels: ChannelView[]; deliveries: DeliveryView[] }> {
  const supabase = await createClient();
  const { data: channels, error } = await supabase
    .from('notification_channels')
    .select('id, type, target, events, enabled')
    .eq('project_id', projectId)
    .order('created_at');
  if (error) throw new Error(`Could not load notification channels: ${error.message}`);
  const ids = channels.map((channel) => channel.id);
  const { data: log, error: logError } = ids.length
    ? await supabase
        .from('notification_log')
        .select('id, channel_id, event, status, error, created_at')
        .in('channel_id', ids)
        .order('created_at', { ascending: false })
        .limit(LOG_LIMIT)
    : { data: [], error: null };
  if (logError) throw new Error(`Could not load the delivery log: ${logError.message}`);
  return {
    channels: channels.map((channel) => ({
      id: channel.id,
      type: channel.type,
      target: channel.target,
      events: channel.events as NotificationEvent[],
      enabled: channel.enabled,
    })),
    deliveries: log.map((row) => ({
      id: row.id,
      channelId: row.channel_id,
      event: row.event,
      status: row.status,
      error: row.error,
      createdAt: row.created_at,
    })),
  };
}

export interface ProjectMute {
  projectId: string;
  name: string;
  slug: string;
  muted: boolean;
}

/** The user's projects and whether they muted each (F-NOTIFY-5). */
export async function listProjectMutes(userId: string): Promise<ProjectMute[]> {
  const supabase = await createClient();
  const [projects, mutes] = await Promise.all([
    supabase.from('projects_public').select('id, name, slug').is('archived_at', null).order('name'),
    supabase.from('notification_mutes').select('project_id').eq('user_id', userId),
  ]);
  if (projects.error) throw new Error(`Could not load projects: ${projects.error.message}`);
  if (mutes.error) throw new Error(`Could not load mutes: ${mutes.error.message}`);
  const muted = new Set(mutes.data.map((row) => row.project_id));
  return projects.data.map((project) => ({
    projectId: project.id!,
    name: project.name!,
    slug: project.slug!,
    muted: muted.has(project.id!),
  }));
}
