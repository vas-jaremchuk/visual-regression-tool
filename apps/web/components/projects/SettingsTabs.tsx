'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SETTINGS_TABS } from '@/lib/projects/tabs';
import { cn } from '@/lib/utils';

/** Tab bar of the settings pages; each tab is its own route (`/p/[slug]/settings/[tab]`). */
export function SettingsTabs({ slug }: { slug: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings" className="flex flex-wrap gap-1 border-b pb-2">
      {SETTINGS_TABS.map(({ tab, label }) => {
        const href = `/p/${slug}/settings/${tab}`;
        const active = pathname === href;
        return (
          <Link
            key={tab}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
              active && 'bg-accent font-medium text-accent-foreground',
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
