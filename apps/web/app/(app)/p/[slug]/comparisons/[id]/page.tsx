import type { Metadata } from 'next';
import { ReportPage } from '@/components/report/ReportPage';

export const metadata: Metadata = { title: 'Report · Visual Regression Tool' };

/** Report (08 §3, F-CMP-2..6). Viewer+. */
export default async function ComparisonReportPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  return <ReportPage slug={slug} comparisonId={id} />;
}
