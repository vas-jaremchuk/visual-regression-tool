'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Fragment } from 'react';
import type { ProjectSummary } from './types';

function label(segment: string) {
  const text = decodeURIComponent(segment).replace(/-/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function Breadcrumbs({ projects }: { projects: ProjectSummary[] }) {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);
  const crumbs = [{ href: '/', label: 'Projects' }];
  segments.forEach((segment, index) => {
    if (index === 0 && (segment === 'p' || segment === 'projects')) return;
    const project =
      index === 1 && segments[0] === 'p' ? projects.find((p) => p.slug === segment) : undefined;
    crumbs.push({
      href: `/${segments.slice(0, index + 1).join('/')}`,
      // Run labels (`2026-11-22_09-00-00`) are shown as they are.
      label: project
        ? project.name
        : segments[index - 1] === 'runs'
          ? decodeURIComponent(segment)
          : label(segment),
    });
  });

  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {crumbs.map((crumb, index) => (
          <Fragment key={crumb.href}>
            {index > 0 && <li aria-hidden>/</li>}
            <li>
              {index === crumbs.length - 1 ? (
                <span aria-current="page" className="font-medium text-foreground">
                  {crumb.label}
                </span>
              ) : (
                <Link href={crumb.href} className="hover:text-foreground">
                  {crumb.label}
                </Link>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}
