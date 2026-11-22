import type { PageListItem, ReportSectionsData } from '@/lib/comparisons/report-queries';
import { SECTION_LIMIT } from '@/lib/comparisons/report-queries';

/** Sections below the list (F-CMP-5, F-CMP-6): files, redirected, new and missing pages. */
export function ReportSections({ sections }: { sections: ReportSectionsData }) {
  const { files, redirected, added, missing } = sections;
  return (
    <div className="grid gap-8">
      {files.length > 0 && <FilesSection files={files} />}
      {redirected.length > 0 && (
        <PageSection
          id="redirected"
          title={`Redirected pages, not compared (${redirected.length})`}
          items={redirected}
          className="border-l-[#a78bfa] bg-[#261f3a]"
          note={(item) =>
            item.redirectTo ? (
              <>
                ↪️ redirects to{' '}
                <a
                  href={item.redirectTo}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  {item.redirectTo}
                </a>
              </>
            ) : (
              '↪️ redirect detected'
            )
          }
        />
      )}
      {added.length > 0 && (
        <PageSection
          id="new"
          title={`New pages (${added.length})`}
          items={added}
          className="border-l-[#3b82f6] bg-[#1c2c42]"
          note={() => '(not in before set)'}
        />
      )}
      {missing.length > 0 && (
        <PageSection
          id="missing"
          title={`Missing pages (${missing.length})`}
          items={missing}
          className="border-l-[#f97316] bg-[#2a1f10]"
          note={() => '(missing in after set)'}
        />
      )}
    </div>
  );
}

function Truncated({ count }: { count: number }) {
  if (count < SECTION_LIMIT) return null;
  return <p className="text-xs text-muted-foreground">Showing the first {SECTION_LIMIT}.</p>;
}

function ItemLink({ url, name }: { url: string | null; name: string }) {
  return url ? (
    <a href={url} target="_blank" rel="noopener noreferrer" className="break-all hover:underline">
      {url}
    </a>
  ) : (
    <span className="break-all">{name}</span>
  );
}

function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mb-2.5 text-sm font-bold uppercase tracking-wider text-slate-400">
      {children}
    </h2>
  );
}

function PageSection({
  id,
  title,
  items,
  className,
  note,
}: {
  id: string;
  title: string;
  items: PageListItem[];
  className: string;
  note: (item: PageListItem) => React.ReactNode;
}) {
  return (
    <section aria-labelledby={id}>
      <SectionHeading id={id}>{title}</SectionHeading>
      <ul className="grid gap-1.5">
        {items.map((item) => (
          <li
            key={item.id}
            className={`rounded-md border-l-[3px] px-3 py-1.5 text-sm ${className}`}
          >
            <ItemLink url={item.url} name={item.name} />{' '}
            {item.viewportSlug && (
              <span className="text-xs text-muted-foreground">[{item.viewportSlug}]</span>
            )}{' '}
            <em className="text-slate-400 not-italic">{note(item)}</em>
          </li>
        ))}
      </ul>
      <Truncated count={items.length} />
    </section>
  );
}

function FilesSection({ files }: { files: ReportSectionsData['files'] }) {
  const changed = files.filter((f) => f.status === 'changed');
  const unchanged = files.filter((f) => f.status === 'unchanged');
  const added = files.filter((f) => f.status === 'new');
  const missing = files.filter((f) => f.status === 'missing');
  return (
    <section aria-labelledby="files" className="grid gap-2.5">
      <SectionHeading id="files">Files, fingerprint check ({files.length})</SectionHeading>
      <p className="text-sm text-slate-400">
        {changed.length} changed · {unchanged.length} unchanged
        {added.length > 0 && ` · ${added.length} new`}
        {missing.length > 0 && ` · ${missing.length} missing`}
      </p>
      {changed.length > 0 ? (
        <>
          <div
            role="status"
            className="rounded-lg border border-[#7f1d1d] bg-[#3b1f2b] px-3.5 py-2.5 font-semibold text-[#fca5a5]"
          >
            🔔 {changed.length} file(s) have a different fingerprint
          </div>
          {changed.map((file) => (
            <div
              key={file.id}
              className="rounded-lg border border-l-[3px] border-[#2d3748] border-l-[#ef4444] bg-[#1a1f2e] px-3.5 py-3"
            >
              <div className="mb-2 text-sm font-semibold">
                ⚠️ <ItemLink url={file.url} name={file.name} />
              </div>
              <dl className="grid grid-cols-[4rem_1fr] gap-x-2.5 gap-y-1 text-xs">
                {(['before', 'after'] as const).map((side) => (
                  <div key={side} className="contents">
                    <dt className="font-semibold uppercase text-slate-500">{side}</dt>
                    <dd className="break-all">
                      <code className="font-mono">{file[side]?.sha256 ?? 'n/a'}</code>{' '}
                      <span className="text-slate-500">{file[side]?.size ?? '?'} bytes</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </>
      ) : (
        <div
          role="status"
          className="rounded-lg border border-[#14532d] bg-[#1a2e22] px-3.5 py-2.5 text-[#4ade80]"
        >
          ✅ All file fingerprints match.
        </div>
      )}
      {added.length > 0 && (
        <FileList
          title={`No fingerprint in before set (${added.length})`}
          files={added}
          note="(new)"
          className="border-l-[#3b82f6] bg-[#1c2c42]"
        />
      )}
      {missing.length > 0 && (
        <FileList
          title={`No fingerprint in after set (${missing.length})`}
          files={missing}
          note="(missing)"
          className="border-l-[#f97316] bg-[#2a1f10]"
        />
      )}
      <Truncated count={files.length} />
    </section>
  );
}

function FileList({
  title,
  files,
  note,
  className,
}: {
  title: string;
  files: ReportSectionsData['files'];
  note: string;
  className: string;
}) {
  return (
    <>
      <h3 className="mt-2 text-xs font-semibold text-slate-400">{title}</h3>
      <ul className="grid gap-1.5">
        {files.map((file) => (
          <li
            key={file.id}
            className={`rounded-md border-l-[3px] px-3 py-1.5 text-sm ${className}`}
          >
            <ItemLink url={file.url} name={file.name} />{' '}
            <em className="text-slate-400 not-italic">{note}</em>
          </li>
        ))}
      </ul>
    </>
  );
}
