'use client';

import { Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { ProjectSummary } from './types';

const PROJECT_NAV = [
  { label: 'Overview', path: '' },
  { label: 'Sitemap', path: '/sitemap' },
  { label: 'Runs', path: '/runs' },
  { label: 'Comparisons', path: '/comparisons' },
  { label: 'Ignore rules', path: '/ignore-rules' },
  { label: 'Storage', path: '/storage' },
  { label: 'Settings', path: '/settings' },
];

const ADMIN_NAV = [
  { label: 'Users', href: '/admin/users' },
  { label: 'Audit log', href: '/admin/audit' },
  { label: 'Jobs', href: '/admin/jobs' },
  { label: 'Storage', href: '/admin/storage' },
];

function NavLink({ href, active, children }: { href: string; active: boolean; children: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'block rounded-md px-2 py-1.5 text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
        active && 'bg-accent font-medium text-accent-foreground',
      )}
    >
      {children}
    </Link>
  );
}

function SectionHeading({ children }: { children: string }) {
  return (
    <h2 className="px-2 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
      {children}
    </h2>
  );
}

/** Left sidebar (08 §2): project switcher with search, project nav, admin section. */
export function AppSidebar({
  projects,
  isPlatformAdmin,
}: {
  projects: ProjectSummary[];
  isPlatformAdmin: boolean;
}) {
  const pathname = usePathname();
  const [query, setQuery] = useState('');
  const currentSlug = /^\/p\/([^/]+)/.exec(pathname)?.[1];
  const current = projects.find((project) => project.slug === currentSlug);
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? projects.filter(
        (project) => project.name.toLowerCase().includes(needle) || project.slug.includes(needle),
      )
    : projects;

  return (
    <aside
      aria-label="Sidebar"
      className="flex w-64 shrink-0 flex-col gap-6 overflow-y-auto border-r bg-sidebar p-4 text-sidebar-foreground"
    >
      <Link href="/" className="px-2 text-base font-semibold">
        Visual Regression
      </Link>

      <nav aria-label="Projects" className="grid gap-2">
        <SectionHeading>Projects</SectionHeading>
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-2.5 left-2 size-4 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            aria-label="Search projects"
            placeholder="Search projects"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="pl-8"
          />
        </div>
        <ul className="grid gap-0.5">
          {filtered.map((project) => (
            <li key={project.id}>
              <NavLink href={`/p/${project.slug}`} active={project.slug === currentSlug}>
                {project.name}
              </NavLink>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="px-2 py-1.5 text-sm text-muted-foreground">
              {projects.length === 0 ? 'No projects' : 'No matching projects'}
            </li>
          )}
        </ul>
      </nav>

      {current && (
        <nav aria-label={`${current.name} navigation`} className="grid gap-0.5">
          <SectionHeading>{current.name}</SectionHeading>
          {PROJECT_NAV.map((item) => {
            const href = `/p/${current.slug}${item.path}`;
            const active = item.path === '' ? pathname === href : pathname.startsWith(href);
            return (
              <NavLink key={item.label} href={href} active={active}>
                {item.label}
              </NavLink>
            );
          })}
        </nav>
      )}

      {isPlatformAdmin && (
        <nav aria-label="Admin" className="grid gap-0.5">
          <SectionHeading>Admin</SectionHeading>
          {ADMIN_NAV.map((item) => (
            <NavLink key={item.href} href={item.href} active={pathname.startsWith(item.href)}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      )}
    </aside>
  );
}
