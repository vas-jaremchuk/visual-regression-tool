import type { SharedReport as SharedReportData } from '@/lib/share/service';
import { ReportSections } from './ReportSections';
import { ReportView } from './ReportView';

/**
 * Public share view (04 §5, 08 §3): the report without navigation, review controls or settings,
 * under a read-only banner. Only data of the shared comparison is passed in.
 */
export function SharedReport({ token, report }: { token: string; report: SharedReportData }) {
  const { header } = report;
  return (
    <div className="min-h-screen">
      <div
        role="note"
        className="border-b border-[#1e40af] bg-[#1c2c42] px-4 py-2 text-center text-sm text-[#93c5fd]"
      >
        Shared read-only view of <strong>{report.projectName}</strong>
        {header.share.expiresAt && (
          <>
            {' '}
            · link expires{' '}
            <time dateTime={header.share.expiresAt}>
              {new Date(header.share.expiresAt).toLocaleDateString('en', { dateStyle: 'medium' })}
            </time>
          </>
        )}
      </div>
      <main className="mx-auto grid max-w-[100rem] gap-6 p-4 sm:p-6">
        <header className="grid gap-1">
          <h1 className="font-mono text-xl font-semibold">
            {header.beforeLabel} <span aria-label="versus">↔</span> {header.afterLabel}
          </h1>
          <p className="text-sm text-muted-foreground">
            Threshold: &gt;{header.changeThresholdPct ?? 0}% pixel change
          </p>
          {(header.status === 'queued' || header.status === 'running') && (
            <p role="status" className="text-sm text-muted-foreground">
              The comparison is still running; reload to see more results.
            </p>
          )}
        </header>

        <ReportView
          slug=""
          comparisonId={report.comparisonId}
          publicUrl={report.publicUrl}
          beforeLabel={header.beforeLabel}
          afterLabel={header.afterLabel}
          counts={header.counts}
          viewports={header.viewports}
          changeThresholdPct={header.changeThresholdPct}
          initialItems={report.firstPage.items}
          initialTotal={report.firstPage.total ?? 0}
          initialItem={null}
          shareToken={token}
          reviewCounts={header.reviewCounts}
          canReview={false}
          canSetBaseline={false}
          afterRunId={header.afterRunId}
          afterIsBaseline={false}
          projectId=""
          canManageRules={false}
          projectViewports={[]}
        />

        <ReportSections sections={report.sections} />
      </main>
    </div>
  );
}
