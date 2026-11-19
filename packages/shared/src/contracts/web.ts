import { z } from 'zod';
import { SHARE_LINK_DEFAULT_DAYS } from '../constants';
import { httpUrl, id, runLabel, viewportSlug } from './common';
import { itemKind, projectRole, reviewStatus } from './enums';
import { projectSecretsSchema, projectSettingsSchema } from './project-settings';

/** Bodies and responses of the web app's custom endpoints (09 §1). */

export const workflowStartedResponse = z.object({ workflowId: z.string().min(1) });
export type WorkflowStartedResponse = z.infer<typeof workflowStartedResponse>;

// POST /api/projects
export const createProjectRequest = projectSettingsSchema
  .extend({ slug: projectSettingsSchema.shape.slug.optional() })
  .extend(projectSecretsSchema.shape);
export type CreateProjectRequest = z.input<typeof createProjectRequest>;
export const createProjectResponse = z.object({ projectId: id, slug: z.string() });

// POST /api/projects/import-env
export const importEnvRequest = z.object({ text: z.string().max(100_000) });
export const importEnvResponse = z.object({
  preview: createProjectRequest.partial(),
  ignoredKeys: z.array(z.string()),
  notes: z.array(z.string()),
});
export type ImportEnvResponse = z.infer<typeof importEnvResponse>;

// POST /api/projects/:id/check-bucket
export const checkBucketRequest = z.object({ create: z.boolean().default(false) });
export const checkBucketResponse = z.object({
  exists: z.boolean(),
  created: z.boolean(),
  canReadWriteDelete: z.boolean(),
  publicUrl: z.enum(['ok', 'failed', 'not_configured']),
  error: z.string().optional(),
});

// POST /api/projects/:id/sitemap
export const startSitemapResponse = z.object({ snapshotId: id, workflowId: z.string() });

// POST /api/projects/:id/runs
export const runScope = z.enum(['all', 'pages', 'files', 'custom', 'sample']);
export const startRunRequest = z
  .object({
    snapshotId: id,
    viewports: z.array(viewportSlug).min(1),
    scope: runScope.default('all'),
    urls: z.array(httpUrl).min(1).optional(),
    sample: z.int().min(1).optional(),
    note: z.string().max(500).optional(),
    dryRun: z.boolean().default(false),
  })
  .refine((body) => body.scope !== 'custom' || body.urls, {
    message: 'urls is required when scope is custom',
    path: ['urls'],
  })
  .refine((body) => body.scope !== 'sample' || body.sample, {
    message: 'sample is required when scope is sample',
    path: ['sample'],
  });
export type StartRunRequest = z.input<typeof startRunRequest>;
export const dryRunItem = z.object({
  url: z.string(),
  kind: itemKind,
  viewportSlug: viewportSlug.nullable(),
  filename: z.string(),
});
export const startRunResponse = z.union([
  z.object({ dryRun: z.literal(false), runId: id, label: runLabel }),
  z.object({ dryRun: z.literal(true), items: z.array(dryRunItem) }),
]);
export type StartRunResponse = z.infer<typeof startRunResponse>;

// DELETE /api/runs/:id?confirm=true
export const deleteRunQuery = z.object({ confirm: z.literal('true') });
export const deleteRunResponse = z.object({
  deleting: z.object({
    comparisons: z.array(z.object({ id, label: z.string() })),
    objects: z.int().min(0),
  }),
});

// POST /api/projects/:id/import-legacy
export const importLegacyRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }),
  z.object({ action: z.literal('import'), labels: z.array(runLabel).min(1) }),
]);
export const importLegacyResponse = z.union([
  z.object({ labels: z.array(runLabel) }),
  workflowStartedResponse,
]);

// POST /api/projects/:id/comparisons
export const startComparisonRequest = z.object({
  beforeRunId: id,
  afterRunId: id,
  replace: z.boolean().default(false),
});
export const startComparisonResponse = z.object({ comparisonId: id, label: z.string() });

// POST /api/comparisons/:id/review
export const reviewRequest = z.object({
  itemIds: z.array(id).min(1).max(1000),
  review: reviewStatus,
  note: z.string().max(1000).optional(),
});
export const reviewResponse = z.object({ updated: z.int().min(0) });

// POST /api/comparisons/:id/rediff
export const rediffResponse = workflowStartedResponse;

// POST /api/comparisons/:id/share
export const createShareRequest = z.object({
  expiresInDays: z.int().min(1).max(365).default(SHARE_LINK_DEFAULT_DAYS),
});
export const createShareResponse = z.object({ url: z.url(), expiresAt: z.iso.datetime() });

// GET /api/r2/sign?key=…&comparison=…
export const signR2Query = z.object({
  key: z.string().min(1),
  comparison: id.optional(),
  token: z.string().optional(),
});
export const signR2Response = z.object({ url: z.url(), expiresAt: z.iso.datetime() });

// POST /api/projects/:id/storage/refresh
export const refreshStorageResponse = workflowStartedResponse;

// POST /api/invitations
export const createInvitationRequest = z.object({
  email: z.email().transform((email) => email.toLowerCase()),
  projectId: id.nullable().default(null),
  role: projectRole.default('viewer'),
});
export const createInvitationResponse = z.object({
  invitationId: id,
  status: z.enum(['invited', 'added']),
});
