'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import type { ActionResult } from '@/lib/members/action-result';

/** Runs a server action in a transition and toasts its result (08 §4). */
export function useAction() {
  const [pending, startTransition] = useTransition();
  const run = (action: () => Promise<ActionResult>, onSuccess?: () => void) =>
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(result.message);
        onSuccess?.();
      } else {
        toast.error(result.message);
      }
    });
  return [pending, run] as const;
}
