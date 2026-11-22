import type { Metadata } from 'next';
import { ReportPage } from '@/components/report/ReportPage';

export const metadata: Metadata = { title: 'Item · Visual Regression Tool' };

/** Deep-linkable item viewer (08 §1): the report with this item selected. Viewer+. */
export default async function ComparisonItemPage({
  params,
}: {
  params: Promise<{ slug: string; id: string; itemId: string }>;
}) {
  const { slug, id, itemId } = await params;
  return <ReportPage slug={slug} comparisonId={id} itemId={itemId} />;
}
