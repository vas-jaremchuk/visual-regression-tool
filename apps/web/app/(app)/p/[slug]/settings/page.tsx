import { redirect } from 'next/navigation';
import { requireProjectSettings } from '@/lib/projects/access';

/** `/p/[slug]/settings` opens the General tab; non-admins get a 403. */
export default async function SettingsIndex({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireProjectSettings(slug);
  redirect(`/p/${slug}/settings/general`);
}
