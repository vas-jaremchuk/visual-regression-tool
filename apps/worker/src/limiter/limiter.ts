import { BROWSER_MAX_SESSIONS, LIMITER_LEASE_MS } from '@vrt/shared';
import type { ProjectLimiter } from './project-limiter';

export const GLOBAL_LIMITER = 'global';

/** A held slot; `release` is idempotent. */
export interface LimiterSlot {
  release(): Promise<void>;
}

export interface Limiter {
  /** Takes one project slot and one global slot, or returns null when either is full. */
  acquire(projectId: string, projectLimit: number): Promise<LimiterSlot | null>;
}

/** `Limiter` over the `PROJECT_LIMITER` Durable Object namespace. */
export function durableLimiter(namespace: DurableObjectNamespace<ProjectLimiter>): Limiter {
  const stub = (name: string) => namespace.get(namespace.idFromName(name));
  return {
    async acquire(projectId, projectLimit) {
      const holder = crypto.randomUUID();
      const project = stub(projectId);
      const global = stub(GLOBAL_LIMITER);
      if (!(await project.acquire(holder, projectLimit, LIMITER_LEASE_MS))) return null;
      if (!(await global.acquire(holder, BROWSER_MAX_SESSIONS, LIMITER_LEASE_MS))) {
        await project.release(holder);
        return null;
      }
      let released = false;
      return {
        async release() {
          if (released) return;
          released = true;
          await Promise.all([project.release(holder), global.release(holder)]);
        },
      };
    },
  };
}
