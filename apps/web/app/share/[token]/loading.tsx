import { Loader2 } from 'lucide-react';

export default function Loading() {
  return (
    <p role="status" className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      Loading the shared report…
    </p>
  );
}
