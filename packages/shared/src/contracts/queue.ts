import { z } from 'zod';
import { id } from './common';

/** Queue messages (09 §3). */

export const captureMsg = z.object({ v: z.literal(1), runId: id, itemIds: z.array(id).min(1) });
export type CaptureMsg = z.infer<typeof captureMsg>;

export const diffMsg = z.object({ v: z.literal(1), comparisonId: id, itemIds: z.array(id).min(1) });
export type DiffMsg = z.infer<typeof diffMsg>;
