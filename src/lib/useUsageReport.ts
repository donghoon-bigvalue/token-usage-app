import { useEffect, useState, useCallback } from "react";
import { fetchUsage, fetchCachedUsage, onUsageUpdated, mergeReport, applyCachePaint } from "./usage";
import type { UsageReport } from "./types";

export interface UseUsageReport {
  report: UsageReport | null;
  loadFailed: string | null;
  now: number;
  reload: () => Promise<void>;
}

/// The widget's single source of usage data: mirrors App's limits fetch —
/// keeps the last good snapshot per provider (mergeReport) across a transient
/// failure, subscribes to the backend poller's `usage-updated` events, and
/// ticks `now` each second for the reset countdowns.
export function useUsageReport(): UseUsageReport {
  const [report, setReport] = useState<UsageReport | null>(null);
  const [loadFailed, setLoadFailed] = useState<string | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  const apply = useCallback((next: UsageReport) => {
    setReport((prev) => mergeReport(prev, next));
  }, []);

  const reload = useCallback(
    () =>
      fetchUsage()
        .then((r) => { apply(r); setLoadFailed(null); })
        .catch((e) => setLoadFailed(e instanceof Error ? e.message : String(e))),
    [apply]
  );

  useEffect(() => {
    // 디스크 캐시를 먼저 즉시 그린다(있을 때, 그리고 아직 아무것도 없을 때만).
    fetchCachedUsage()
      .then((c) => { if (c) setReport((prev) => applyCachePaint(prev, c)); })
      .catch(() => {});
    reload();
    const un = onUsageUpdated(apply);
    return () => { un.then((f) => f()); };
  }, [apply, reload]);

  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  return { report, loadFailed, now, reload };
}
