import { Skeleton } from "./Skeleton";

/**
 * Mirrors ProviderCard's classes and dimensions so the real card drops in
 * without moving anything. `bars` differs per provider — Claude has 3 windows,
 * Codex 2 — and a wrong count would shift the layout on arrival, which is the
 * one thing a skeleton exists to prevent.
 */
export function ProviderCardSkeleton({ bars }: { bars: number }) {
  return (
    <section className="provider-card" data-testid="provider-skeleton" aria-hidden="true">
      <header className="provider-card__head provider-card__head--skeleton">
        <Skeleton width="84px" height={16} radius={6} />
        <Skeleton width="52px" height={18} />
      </header>
      <div className="provider-card__bars">
        {Array.from({ length: bars }, (_, i) => (
          <div className="limit-bar" key={i}>
            <div className="limit-bar__row limit-bar__row--skeleton">
              <Skeleton width="112px" height={12} radius={4} />
              <Skeleton width="32px" height={12} radius={4} />
            </div>
            <div className="limit-bar__track">
              <Skeleton width="100%" height={8} />
            </div>
            <div className="limit-bar__reset">
              <Skeleton width="96px" height={10} radius={4} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
