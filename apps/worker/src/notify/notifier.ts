import {
  deliverNotification,
  emailRecipients,
  type ComparisonNotice,
  type DeliverableChannel,
  type DeliverOptions,
  type Notice,
  type NotificationEvent,
  type NotificationLogEntry,
  type RunNotice,
} from '@vrt/shared';
import type { Logger } from '../logger';

/**
 * Worker notifier (07 F-NOTIFY-1..5; 06 §2 step 4, §5 step 9). Sends a finished run or
 * comparison to every enabled channel of its project subscribed to the event, once per channel:
 * a workflow step that retries after a send finds the `sent` log row and skips that channel.
 * Never throws, so a notification problem cannot fail or replay the finalise step.
 */

export interface ChannelRow {
  id: string;
  type: 'email' | 'slack';
  target: string | null;
  targetEnc: string | null;
}

export interface NotifyStore {
  loadProject(projectId: string): Promise<{ name: string; slug: string }>;
  /** Enabled channels of the project whose `events` contain `event`. */
  listChannels(projectId: string, event: NotificationEvent): Promise<ChannelRow[]>;
  /** Every project member's email and whether they muted the project (F-NOTIFY-5). */
  listMembers(projectId: string): Promise<{ email: string; muted: boolean }[]>;
  wasSent(channelId: string, event: NotificationEvent, entityId: string): Promise<boolean>;
  log(entry: NotificationLogEntry): Promise<void>;
  loadComparisonNotice(
    comparisonId: string,
  ): Promise<Omit<ComparisonNotice, 'kind' | 'event' | 'project'>>;
  loadRunNotice(runId: string): Promise<Omit<RunNotice, 'kind' | 'event' | 'project' | 'error'>>;
}

export interface ProjectNotifierDeps {
  store: NotifyStore;
  decrypt(targetEnc: string): Promise<string>;
  appUrl: string;
  transports: DeliverOptions['transports'];
  retry?: DeliverOptions['retry'];
  logger?: Logger;
}

export interface ProjectNotifier {
  comparison(
    event: ComparisonNotice['event'],
    context: { projectId: string; comparisonId: string },
  ): Promise<void>;
  run(
    event: RunNotice['event'],
    context: { projectId: string; runId: string; error?: string },
  ): Promise<void>;
}

export function createProjectNotifier(deps: ProjectNotifierDeps): ProjectNotifier {
  const { store } = deps;

  async function send(
    projectId: string,
    event: NotificationEvent,
    entityId: string,
    build: (project: { name: string; slug: string }) => Promise<Notice>,
  ): Promise<void> {
    try {
      const channels = await store.listChannels(projectId, event);
      if (channels.length === 0) return;
      const notice = await build(await store.loadProject(projectId));
      let members: { email: string; muted: boolean }[] | null = null;
      for (const channel of channels) {
        if (await store.wasSent(channel.id, event, entityId)) continue;
        let deliverable: DeliverableChannel;
        try {
          if (channel.type === 'email') {
            members ??= await store.listMembers(projectId);
            deliverable = {
              id: channel.id,
              type: 'email',
              recipients: emailRecipients(channel.target, members),
            };
          } else {
            if (!channel.targetEnc) throw new Error('The channel has no webhook URL');
            deliverable = {
              id: channel.id,
              type: 'slack',
              webhookUrl: await deps.decrypt(channel.targetEnc),
            };
          }
        } catch (error) {
          await store.log({
            channelId: channel.id,
            event,
            entityId,
            status: 'failed',
            error: (error instanceof Error ? error.message : String(error)).slice(0, 1_000),
          });
          continue;
        }
        const entry = await deliverNotification(deliverable, notice, entityId, {
          appUrl: deps.appUrl,
          transports: deps.transports,
          log: (row) => store.log(row),
          retry: deps.retry,
        });
        if (entry.status === 'failed') {
          deps.logger?.warn('notification failed', { channelId: channel.id, event });
        }
      }
    } catch (error) {
      deps.logger?.error('notifications could not be sent', { event, entityId, error });
    }
  }

  return {
    comparison: (event, { projectId, comparisonId }) =>
      send(projectId, event, comparisonId, async (project) => ({
        kind: 'comparison',
        event,
        project,
        ...(await store.loadComparisonNotice(comparisonId)),
      })),
    run: (event, { projectId, runId, error }) =>
      send(projectId, event, runId, async (project) => ({
        kind: 'run',
        event,
        project,
        ...(await store.loadRunNotice(runId)),
        error: error ?? null,
      })),
  };
}
