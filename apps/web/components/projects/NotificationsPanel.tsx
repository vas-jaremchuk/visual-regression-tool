'use client';

import { NOTIFICATION_EVENT_LABELS, notificationEvent, type NotificationEvent } from '@vrt/shared';
import { Loader2, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  addNotificationChannel,
  editNotificationChannel,
  removeNotificationChannel,
  sendTestNotification,
} from '@/app/(app)/p/[slug]/settings/actions';
import { selectClassName } from '@/components/members/role-select-class';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ChannelView, DeliveryView } from '@/lib/notifications/queries';
import type { FieldErrors } from '@/lib/projects/settings-groups';
import { FieldError } from './SettingsForm';

type ChannelKind = 'email' | 'slack';

interface Draft {
  type: ChannelKind;
  allMembers: boolean;
  target: string;
  webhookUrl: string;
  events: NotificationEvent[];
  enabled: boolean;
}

type ActionOutcome = { ok: boolean; message: string; fieldErrors?: FieldErrors };

const EVENTS = notificationEvent.options;

const EMPTY: Draft = {
  type: 'email',
  allMembers: true,
  target: '',
  webhookUrl: '',
  events: ['comparison_changed', 'run_failed'],
  enabled: true,
};

function toDraft(channel: ChannelView): Draft {
  return {
    type: channel.type,
    allMembers: channel.type === 'email' && channel.target === null,
    target: channel.target ?? '',
    webhookUrl: '',
    events: channel.events,
    enabled: channel.enabled,
  };
}

function toInput(draft: Draft) {
  return draft.type === 'email'
    ? {
        type: 'email' as const,
        allMembers: draft.allMembers,
        target: draft.target,
        events: draft.events,
        enabled: draft.enabled,
      }
    : {
        type: 'slack' as const,
        webhookUrl: draft.webhookUrl,
        events: draft.events,
        enabled: draft.enabled,
      };
}

function describeTarget(channel: ChannelView): string {
  if (channel.type === 'slack') return 'Slack incoming webhook';
  return channel.target ?? 'All project members';
}

function useRunner() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (action: () => Promise<ActionOutcome>, onDone?: (r: ActionOutcome) => void) =>
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
      router.refresh();
      onDone?.(result);
    });
  return [pending, run] as const;
}

function ChannelForm({
  idPrefix,
  initial,
  editing,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
  errors,
}: {
  idPrefix: string;
  initial: Draft;
  editing: boolean;
  submitLabel: string;
  pending: boolean;
  onSubmit: (draft: Draft) => void;
  onCancel?: () => void;
  errors: FieldErrors;
}) {
  const [draft, setDraft] = useState(initial);
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const toggleEvent = (event: NotificationEvent, on: boolean) =>
    set({
      events: on ? [...draft.events, event] : draft.events.filter((value) => value !== event),
    });

  return (
    <form
      noValidate
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(draft);
      }}
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="grid gap-2">
          <Label htmlFor={`${idPrefix}-type`}>Type</Label>
          <select
            id={`${idPrefix}-type`}
            className={selectClassName}
            value={draft.type}
            disabled={pending || editing}
            onChange={(event) => set({ type: event.target.value as ChannelKind })}
          >
            <option value="email">Email</option>
            <option value="slack">Slack</option>
          </select>
        </div>
        {draft.type === 'email' ? (
          <div className="grid gap-2">
            <Label htmlFor={`${idPrefix}-target`}>Email address</Label>
            <Input
              id={`${idPrefix}-target`}
              type="email"
              className="w-72"
              value={draft.target}
              disabled={pending || draft.allMembers}
              aria-invalid={errors.target ? true : undefined}
              aria-describedby={errors.target ? `${idPrefix}-target-error` : undefined}
              onChange={(event) => set({ target: event.target.value })}
            />
            <FieldError id={`${idPrefix}-target-error`} message={errors.target} />
          </div>
        ) : (
          <div className="grid gap-2">
            <Label htmlFor={`${idPrefix}-webhookUrl`}>Webhook URL</Label>
            <Input
              id={`${idPrefix}-webhookUrl`}
              type="password"
              autoComplete="off"
              className="w-96"
              placeholder={
                editing ? 'Leave blank to keep the saved URL' : 'https://hooks.slack.com/services/…'
              }
              value={draft.webhookUrl}
              disabled={pending}
              aria-invalid={errors.webhookUrl ? true : undefined}
              aria-describedby={errors.webhookUrl ? `${idPrefix}-webhookUrl-error` : undefined}
              onChange={(event) => set({ webhookUrl: event.target.value })}
            />
            <FieldError id={`${idPrefix}-webhookUrl-error`} message={errors.webhookUrl} />
          </div>
        )}
      </div>
      {draft.type === 'email' && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={draft.allMembers}
            disabled={pending}
            onChange={(event) => set({ allMembers: event.target.checked })}
          />
          Send to all project members (members can mute the project in their account)
        </label>
      )}
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">Events</legend>
        <div className="flex flex-wrap gap-4">
          {EVENTS.map((event) => (
            <label key={event} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={draft.events.includes(event)}
                disabled={pending}
                onChange={(e) => toggleEvent(event, e.target.checked)}
              />
              {NOTIFICATION_EVENT_LABELS[event]}
            </label>
          ))}
        </div>
        <FieldError id={`${idPrefix}-events-error`} message={errors.events} />
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={draft.enabled}
          disabled={pending}
          onChange={(event) => set({ enabled: event.target.checked })}
        />
        Enabled
      </label>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

function ChannelRow({
  channel,
  deliveries,
  disabled,
}: {
  channel: ChannelView;
  deliveries: DeliveryView[];
  disabled: boolean;
}) {
  const [pending, run] = useRunner();
  const [editing, setEditing] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const failures = deliveries.filter((delivery) => delivery.status === 'failed');

  return (
    <li className="grid gap-3 rounded-md border p-3">
      {editing ? (
        <ChannelForm
          idPrefix={`channel-${channel.id}`}
          initial={toDraft(channel)}
          editing
          submitLabel="Save"
          pending={pending}
          errors={errors}
          onCancel={() => setEditing(false)}
          onSubmit={(draft) =>
            run(
              () => editNotificationChannel({ channelId: channel.id, channel: toInput(draft) }),
              (result) => {
                setErrors(result.fieldErrors ?? {});
                if (result.ok) setEditing(false);
              },
            )
          }
        />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid gap-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">{channel.type === 'email' ? 'Email' : 'Slack'}</span>
              <span className="text-sm text-muted-foreground">{describeTarget(channel)}</span>
              {!channel.enabled && <Badge variant="secondary">Disabled</Badge>}
              {failures.length > 0 && (
                <Badge variant="outline" className="border-destructive text-destructive">
                  {failures.length} failed
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {channel.events.map((event) => NOTIFICATION_EVENT_LABELS[event]).join(', ')}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pending || disabled}
              onClick={() => run(() => sendTestNotification({ channelId: channel.id }))}
            >
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
              Send test
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-label={`Edit ${channel.type} channel ${describeTarget(channel)}`}
              disabled={pending || disabled}
              onClick={() => setEditing(true)}
            >
              <Pencil aria-hidden />
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-label={`Delete ${channel.type} channel ${describeTarget(channel)}`}
              disabled={pending || disabled}
              onClick={() => {
                if (window.confirm('Delete this channel and its delivery log?')) {
                  run(() => removeNotificationChannel({ channelId: channel.id }));
                }
              }}
            >
              <Trash2 aria-hidden />
            </Button>
          </div>
        </div>
      )}
      {deliveries.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm text-muted-foreground">
            Delivery log ({deliveries.length})
          </summary>
          <table className="mt-2 w-full text-left text-sm">
            <thead>
              <tr className="text-muted-foreground">
                <th className="py-1 font-medium">When</th>
                <th className="py-1 font-medium">Event</th>
                <th className="py-1 font-medium">Status</th>
                <th className="py-1 font-medium">Error</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((delivery) => (
                <tr key={delivery.id} className="border-t align-top">
                  <td className="py-1 whitespace-nowrap">
                    {new Date(delivery.createdAt).toLocaleString()}
                  </td>
                  <td className="py-1">{delivery.event}</td>
                  <td className="py-1">
                    <Badge
                      variant={delivery.status === 'sent' ? 'secondary' : 'outline'}
                      className={delivery.status === 'sent' ? undefined : 'text-destructive'}
                    >
                      {delivery.status}
                    </Badge>
                  </td>
                  <td className="py-1 break-all whitespace-pre-wrap">{delivery.error ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </li>
  );
}

/** Settings → Notifications (F-NOTIFY-1/2/4): channels, events, test send, delivery log. */
export function NotificationsPanel({
  projectId,
  channels,
  deliveries,
  disabled,
}: {
  projectId: string;
  channels: ChannelView[];
  deliveries: DeliveryView[];
  disabled: boolean;
}) {
  const [pending, run] = useRunner();
  const [adding, setAdding] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});

  return (
    <div className="grid gap-4">
      {channels.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No channels yet. Add an email address or a Slack webhook to hear about finished runs and
          comparisons.
        </p>
      ) : (
        <ul className="grid gap-3" aria-label="Notification channels">
          {channels.map((channel) => (
            <ChannelRow
              key={channel.id}
              channel={channel}
              deliveries={deliveries.filter((delivery) => delivery.channelId === channel.id)}
              disabled={disabled}
            />
          ))}
        </ul>
      )}
      {adding ? (
        <div className="rounded-md border p-3">
          <ChannelForm
            idPrefix="new-channel"
            initial={EMPTY}
            editing={false}
            submitLabel="Add channel"
            pending={pending}
            errors={errors}
            onCancel={() => setAdding(false)}
            onSubmit={(draft) =>
              run(
                () => addNotificationChannel({ projectId, channel: toInput(draft) }),
                (result) => {
                  setErrors(result.fieldErrors ?? {});
                  if (result.ok) setAdding(false);
                },
              )
            }
          />
        </div>
      ) : (
        <div>
          <Button variant="outline" disabled={disabled} onClick={() => setAdding(true)}>
            <Plus aria-hidden />
            Add channel
          </Button>
        </div>
      )}
    </div>
  );
}
