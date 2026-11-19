import { z } from 'zod';

/** Postgres enums (02 §1). */

export const projectRole = z.enum(['admin', 'editor', 'viewer']);
export type ProjectRole = z.infer<typeof projectRole>;

export const runStatus = z.enum([
  'queued',
  'running',
  'completed',
  'completed_with_errors',
  'failed',
  'cancelled',
  'deleting',
  'delete_failed',
]);
export type RunStatus = z.infer<typeof runStatus>;

export const itemKind = z.enum(['page', 'file']);
export type ItemKind = z.infer<typeof itemKind>;

export const itemStatus = z.enum(['pending', 'processing', 'done', 'failed', 'skipped']);
export type ItemStatus = z.infer<typeof itemStatus>;

export const comparisonStatus = z.enum([
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
  'deleting',
  'delete_failed',
]);
export type ComparisonStatus = z.infer<typeof comparisonStatus>;

export const cmpItemStatus = z.enum([
  'pending',
  'changed',
  'unchanged',
  'new',
  'missing',
  'redirect',
  'error',
]);
export type CmpItemStatus = z.infer<typeof cmpItemStatus>;

export const reviewStatus = z.enum(['pending', 'approved', 'rejected', 'ignored']);
export type ReviewStatus = z.infer<typeof reviewStatus>;

export const ignoreRuleType = z.enum(['url_pattern', 'selector', 'region']);
export type IgnoreRuleType = z.infer<typeof ignoreRuleType>;

export const channelType = z.enum(['email', 'slack']);
export type ChannelType = z.infer<typeof channelType>;

export const notificationEvent = z.enum([
  'comparison_changed',
  'comparison_clean',
  'run_failed',
  'run_completed',
]);
export type NotificationEvent = z.infer<typeof notificationEvent>;
