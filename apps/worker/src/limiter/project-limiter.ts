import { DurableObject } from 'cloudflare:workers';
import { acquireLease, releaseLease, type Leases } from './leases';

const KEY = 'leases';

/**
 * Semaphore Durable Object (06 §2). One instance per project id caps that project at
 * `capture_concurrency` sessions; the instance named `GLOBAL_LIMITER` caps the whole account at
 * `BROWSER_MAX_SESSIONS`. Calls on one instance run one at a time, so read-modify-write is safe.
 */
export class ProjectLimiter extends DurableObject {
  async acquire(holder: string, limit: number, ttlMs: number): Promise<boolean> {
    const next = acquireLease(await this.leases(), holder, limit, ttlMs, Date.now());
    if (!next) return false;
    await this.ctx.storage.put(KEY, next);
    return true;
  }

  async release(holder: string): Promise<void> {
    await this.ctx.storage.put(KEY, releaseLease(await this.leases(), holder, Date.now()));
  }

  private async leases(): Promise<Leases> {
    return (await this.ctx.storage.get<Leases>(KEY)) ?? {};
  }
}
