import type { SupabaseClient } from '@supabase/supabase-js';
import { NOTIFY_TOP_CHANGES } from '@vrt/shared';
import type { ChannelRow, NotifyStore } from './notifier';

/** `NotifyStore` over the service-role Supabase client (RLS bypassed; worker only). */

function check<T>(
  what: string,
  result: { data: T; error: { message: string } | null },
): NonNullable<T> {
  if (result.error) throw new Error(`Could not ${what}: ${result.error.message}`);
  if (result.data === null || result.data === undefined) throw new Error(`Could not ${what}`);
  return result.data;
}

const count = (value: unknown) => (typeof value === 'number' ? value : 0);

export function supabaseNotifyStore(db: SupabaseClient): NotifyStore {
  return {
    async loadProject(projectId) {
      const row = check(
        'load the project',
        await db.from('projects').select('name, slug').eq('id', projectId).single(),
      );
      return { name: row.name as string, slug: row.slug as string };
    },

    async listChannels(projectId, event) {
      const rows = check(
        'load notification channels',
        await db
          .from('notification_channels')
          .select('id, type, target, target_enc')
          .eq('project_id', projectId)
          .eq('enabled', true)
          .contains('events', [event])
          .order('created_at'),
      );
      return rows.map((row): ChannelRow => ({
        id: row.id,
        type: row.type,
        target: row.target,
        targetEnc: row.target_enc,
      }));
    },

    async listMembers(projectId) {
      const [members, mutes] = await Promise.all([
        db
          .from('project_members')
          .select('user_id, profiles!inner(email, disabled_at)')
          .eq('project_id', projectId),
        db.from('notification_mutes').select('user_id').eq('project_id', projectId),
      ]);
      const muted = new Set(check('load mutes', mutes).map((row) => row.user_id as string));
      return check('load project members', members)
        .map((row) => {
          const profile = row.profiles as unknown as { email: string; disabled_at: string | null };
          return { userId: row.user_id as string, ...profile };
        })
        .filter((member) => member.disabled_at === null)
        .map((member) => ({ email: member.email, muted: muted.has(member.userId) }));
    },

    async wasSent(channelId, event, entityId) {
      const rows = check(
        'load the notification log',
        await db
          .from('notification_log')
          .select('id')
          .eq('channel_id', channelId)
          .eq('event', event)
          .eq('entity_id', entityId)
          .eq('status', 'sent')
          .limit(1),
      );
      return rows.length > 0;
    },

    async log(entry) {
      check(
        'write the notification log',
        await db.from('notification_log').insert({
          channel_id: entry.channelId,
          event: entry.event,
          entity_id: entry.entityId,
          status: entry.status,
          error: entry.error,
          sent_at: entry.status === 'sent' ? new Date().toISOString() : null,
        }),
      );
    },

    async loadComparisonNotice(comparisonId) {
      const row = check(
        'load the comparison',
        await db
          .from('comparisons')
          .select(
            'id, label, counts, before:runs!before_run_id(label), after:runs!after_run_id(label)',
          )
          .eq('id', comparisonId)
          .single(),
      );
      const counts = (row.counts ?? {}) as Record<string, unknown>;
      const top = check(
        'load changed items',
        await db
          .from('comparison_items')
          .select('url, viewport_slug, diff_pct')
          .eq('comparison_id', comparisonId)
          .eq('status', 'changed')
          .order('diff_pct', { ascending: false, nullsFirst: false })
          .limit(NOTIFY_TOP_CHANGES),
      );
      return {
        comparison: {
          id: row.id as string,
          label: row.label as string,
          beforeLabel: (row.before as unknown as { label: string }).label,
          afterLabel: (row.after as unknown as { label: string }).label,
        },
        counts: {
          changed: count(counts.changed),
          new: count(counts.new),
          missing: count(counts.missing),
          redirect: count(counts.redirect),
          filesChanged: count(counts.files_changed),
        },
        topChanges: top.map((item) => ({
          url: item.url as string,
          viewportSlug: item.viewport_slug as string | null,
          diffPct: item.diff_pct === null ? null : Number(item.diff_pct),
        })),
      };
    },

    async loadRunNotice(runId) {
      const row = check(
        'load the run',
        await db
          .from('runs')
          .select('id, label, status, total_items, done_items, failed_items')
          .eq('id', runId)
          .single(),
      );
      return {
        run: { id: row.id as string, label: row.label as string, status: row.status as string },
        counts: {
          done: row.done_items as number,
          failed: row.failed_items as number,
          skipped: Math.max(0, row.total_items - row.done_items - row.failed_items),
        },
      };
    },
  };
}
