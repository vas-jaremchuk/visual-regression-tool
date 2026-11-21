/**
 * Counting semaphore with expiring leases (06 §2 `ProjectLimiter`). A lease that is never
 * released (consumer crash, isolate eviction) frees its slot after `ttlMs`.
 */

/** Holder id → expiry (epoch ms). */
export type Leases = Record<string, number>;

export function liveLeases(leases: Leases, now: number): Leases {
  return Object.fromEntries(Object.entries(leases).filter(([, expiresAt]) => expiresAt > now));
}

/** Returns the new lease set, or null when all `limit` slots are taken. Re-acquiring renews. */
export function acquireLease(
  leases: Leases,
  holder: string,
  limit: number,
  ttlMs: number,
  now: number,
): Leases | null {
  const live = liveLeases(leases, now);
  if (!(holder in live) && Object.keys(live).length >= limit) return null;
  return { ...live, [holder]: now + ttlMs };
}

export function releaseLease(leases: Leases, holder: string, now: number): Leases {
  const live = liveLeases(leases, now);
  delete live[holder];
  return live;
}
