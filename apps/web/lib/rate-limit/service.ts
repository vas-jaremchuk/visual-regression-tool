import 'server-only';
import { JOB_START_RATE_LIMIT_PER_MINUTE } from '@vrt/shared';
import type { CurrentUser } from '../auth/session';
import { createClient } from '../supabase/server';
import { enforceRateLimit, type RateLimit } from './limit';

/** Every job start endpoint shares one window per user (NFR-17). */
export const JOB_START_RATE_LIMIT: RateLimit = {
  bucket: 'job_start',
  limit: JOB_START_RATE_LIMIT_PER_MINUTE,
  windowSeconds: 60,
};

/**
 * Counts a job start for the signed-in user and throws a 429 `RequestError` past
 * `JOB_START_RATE_LIMIT`. Anonymous callers pass through: the service refuses them with 401.
 */
export async function limitJobStart(user: CurrentUser | null): Promise<void> {
  if (!user) return;
  const supabase = await createClient();
  await enforceRateLimit(async (bucket, limit, windowSeconds) => {
    const { data, error } = await supabase.rpc('consume_rate_limit', {
      p_bucket: bucket,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) throw new Error(`Could not check the rate limit: ${error.message}`);
    return data;
  }, JOB_START_RATE_LIMIT);
}
