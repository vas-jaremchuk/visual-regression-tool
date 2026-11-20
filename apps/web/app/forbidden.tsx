import { ShieldX } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

/** 403 page rendered by `forbidden()`. */
export default function Forbidden() {
  return (
    <div
      role="alert"
      className="mx-auto flex max-w-md flex-col items-center gap-3 p-12 text-center"
    >
      <ShieldX className="size-10 text-muted-foreground" aria-hidden />
      <h1 className="text-lg font-medium">403: You do not have access to this page</h1>
      <p className="text-sm text-muted-foreground">
        Only project admins can change project settings. Ask a project admin if you need a change.
      </p>
      <Button asChild variant="outline">
        <Link href="/">Back to projects</Link>
      </Button>
    </div>
  );
}
