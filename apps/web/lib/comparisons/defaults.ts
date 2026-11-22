/**
 * F-CMP-1 defaults: before = the baseline, after = the latest completed run. Without a baseline
 * (or when the baseline is the latest run) the two newest runs are used. `runs` is newest first.
 */
export function defaultPair(
  runs: readonly { id: string }[],
  baselineRunId: string | null,
): { beforeRunId: string; afterRunId: string } | null {
  if (runs.length < 2) return null;
  const latest = runs[0]!.id;
  const baseline = runs.find((r) => r.id === baselineRunId)?.id;
  if (baseline && baseline !== latest) return { beforeRunId: baseline, afterRunId: latest };
  return { beforeRunId: runs[1]!.id, afterRunId: latest };
}
