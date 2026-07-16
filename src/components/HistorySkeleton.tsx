import { Skeleton } from "./Skeleton";

/**
 * Mirrors UsageHistoryView's loaded shape: the "this month" heading and two
 * cards, the estimate note, then table rows. Five rows is a plausible history —
 * enough to read as a table, few enough not to overstate what's coming.
 */
export function HistorySkeleton() {
  return (
    <div className="history-view" data-testid="history-skeleton" aria-hidden="true">
      <section className="history-current">
        <Skeleton width="64px" height={15} radius={4} />
        <div className="history-cards">
          {[0, 1].map((i) => (
            <div className="history-card" key={i}>
              <Skeleton width="52px" height={13} radius={4} />
              <Skeleton width="88px" height={13} radius={4} />
              <Skeleton width="72px" height={18} radius={4} />
            </div>
          ))}
        </div>
      </section>
      <Skeleton width="70%" height={12} radius={4} />
      <div className="history-skeleton__rows">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} width="100%" height={28} radius={6} />
        ))}
      </div>
    </div>
  );
}
