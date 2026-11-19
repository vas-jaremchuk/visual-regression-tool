import { z } from 'zod';
import { id, runLabel } from './common';

/** Worker HTTP API (09 §2). Bodies carry ids only, never settings or secrets. */

export const startSitemapJob = z.object({ snapshotId: id });
export const startCaptureJob = z.object({ runId: id });
export const startCompareJob = z.object({ comparisonId: id });
export const deleteJob = z.object({ entity: z.enum(['run', 'comparison', 'project']), id });
export const importLegacyJob = z.object({ projectId: id, labels: z.array(runLabel).min(1) });
export const storageJob = z.object({ projectId: id });

export const jobStartedResponse = z.object({ workflowId: z.string().min(1) });
export type JobStartedResponse = z.infer<typeof jobStartedResponse>;

/** `GET /jobs/:workflowId` passes the Workflow instance status through. */
export const jobStatusResponse = z.object({ status: z.string() }).loose();

export const healthResponse = z.object({ ok: z.boolean(), version: z.string() });

export type StartSitemapJob = z.infer<typeof startSitemapJob>;
export type StartCaptureJob = z.infer<typeof startCaptureJob>;
export type StartCompareJob = z.infer<typeof startCompareJob>;
export type DeleteJob = z.infer<typeof deleteJob>;
export type ImportLegacyJob = z.infer<typeof importLegacyJob>;
export type StorageJob = z.infer<typeof storageJob>;
