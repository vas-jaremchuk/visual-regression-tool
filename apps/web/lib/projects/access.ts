import 'server-only';
import { forbidden, notFound } from 'next/navigation';
import { ForbiddenError, assertCan } from '../auth/assert-can';
import { requireUser, type CurrentUser } from '../auth/session';
import { getProjectDetail, type ProjectDetail } from './queries';

export async function canDo(
  user: CurrentUser,
  action: Parameters<typeof assertCan>[1],
  projectId: string | null,
): Promise<boolean> {
  try {
    await assertCan(user, action, projectId);
    return true;
  } catch (error) {
    if (error instanceof ForbiddenError) return false;
    throw error;
  }
}

/** Settings pages (08 §1): project admins only; others get a 403 (04 §3). */
export async function requireProjectSettings(
  slug: string,
): Promise<{ user: CurrentUser; project: ProjectDetail }> {
  const user = await requireUser();
  const project = await getProjectDetail(slug);
  if (!project) notFound();
  if (!(await canDo(user, 'project.settings', project.id))) forbidden();
  return { user, project };
}
