import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SharedReport } from '@/components/report/SharedReport';
import { getSharedReport } from '@/lib/share/service';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Shared report · Visual Regression Tool',
  robots: { index: false, follow: false },
  // The token is in the URL: do not hand it to the sites the report links to.
  referrer: 'no-referrer',
};

/** Public read-only report (04 §5, 08 §3). Unknown, revoked and expired tokens answer 404. */
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const report = await getSharedReport(token);
  if (!report) notFound();
  return <SharedReport token={token} report={report} />;
}
