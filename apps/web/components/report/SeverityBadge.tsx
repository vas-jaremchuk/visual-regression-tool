import { severity, type Severity } from '@/lib/comparisons/report';
import { cn } from '@/lib/utils';

/** Prototype severity colours (F-CMP-3); the percentage and a label carry the meaning too. */
export const SEVERITY_CLASS: Record<Severity, string> = {
  high: 'bg-[#7f1d1d] text-[#fca5a5]',
  mid: 'bg-[#78350f] text-[#fcd34d]',
  low: 'bg-[#1e3a5f] text-[#93c5fd]',
};

export function SeverityBadge({ pct, className }: { pct: number; className?: string }) {
  const level = severity(pct);
  return (
    <span
      data-severity={level}
      className={cn(
        'inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums',
        SEVERITY_CLASS[level],
        className,
      )}
    >
      {pct.toFixed(2)}%<span className="sr-only"> changed, {level} severity</span>
    </span>
  );
}
