import 'server-only';
import { cache } from 'react';
import { createClient } from './supabase/server';

export interface ProjectListItem {
  id: string;
  slug: string;
  name: string;
  archivedAt: string | null;
  createdAt: string;
}

/**
 * Projects the signed-in user can see, from `projects_public` (RLS-filtered by `can_view`,
 * 04 §3). Archived projects sort last. Cached per request.
 */
export const listProjects = cache(async (): Promise<{ projects: ProjectListItem[] }> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects_public')
    .select('id, slug, name, archived_at, created_at')
    .order('name');
  if (error) throw new Error(`Could not load projects: ${error.message}`);
  const projects = data.flatMap((row) =>
    row.id && row.slug && row.name && row.created_at
      ? [
          {
            id: row.id,
            slug: row.slug,
            name: row.name,
            archivedAt: row.archived_at,
            createdAt: row.created_at,
          },
        ]
      : [],
  );
  projects.sort((a, b) => Number(a.archivedAt !== null) - Number(b.archivedAt !== null));
  return { projects };
});
