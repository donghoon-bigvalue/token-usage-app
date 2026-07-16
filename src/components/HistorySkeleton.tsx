import { Skeleton } from "./Skeleton";

/**
 * Mirrors UsageHistoryView's loaded shape: the "this month" heading and two
 * cards, the estimate note, table rows, then the download button. Five rows
 * is a plausible history — enough to read as a table, few enough not to
 * overstate what's coming; the table's own height still shifts when real
 * rows land, since the row count can't be known before the scan returns.
 * Everything else is wrapped in a `history-skeleton__*` class — a namespace
 * of its own, not a `--skeleton` BEM modifier, since these wrappers never
 * co-occur with the real element's base class the way `ProviderCardSkeleton`'s
 * modifiers do — that reserves the real element's line-box height, so only
 * the table moves.
 */
export function HistorySkeleton() {
  return (
    <div className="history-view" data-testid="history-skeleton" aria-hidden="true">
      <section className="history-current">
        <div className="history-skeleton__title">
          <Skeleton width="64px" height={15} radius={4} />
        </div>
        <div className="history-cards">
          {[0, 1].map((i) => (
            <div className="history-card" key={i}>
              <div className="history-skeleton__card-title">
                <Skeleton width="52px" height={13} radius={4} />
              </div>
              <div className="history-skeleton__card-tokens">
                <Skeleton width="88px" height={13} radius={4} />
              </div>
              <div className="history-skeleton__card-cost">
                <Skeleton width="72px" height={18} radius={4} />
              </div>
            </div>
          ))}
        </div>
      </section>
      <div className="history-skeleton__note">
        <Skeleton width="70%" height={12} radius={4} />
      </div>
      <div className="history-skeleton__rows">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} width="100%" height={28} radius={6} />
        ))}
      </div>
      <div className="history-skeleton__download">
        <Skeleton width="96px" height={12} radius={4} />
      </div>
    </div>
  );
}
