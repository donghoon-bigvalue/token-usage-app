import { Skeleton } from "./Skeleton";
import { SkeletonBars } from "./SkeletonBars";

/**
 * Mirrors ProviderCard's classes and dimensions so the real card drops in
 * without moving anything. `bars` differs per provider — Claude has 3 windows,
 * Codex 2 — and a wrong count would shift the layout on arrival, which is the
 * one thing a skeleton exists to prevent.
 *
 * Known tradeoff: `bars` assumes the success case. A provider that resolves to
 * an error renders a shorter EmptyState instead (ProviderCard), so a cold load
 * ending in an error still shifts the layout. This is unavoidable at skeleton
 * time — the error isn't known until the fetch lands, so we can't size for it.
 */
export function ProviderCardSkeleton({ bars }: { bars: number }) {
  return (
    <section className="provider-card" data-testid="provider-skeleton" aria-hidden="true">
      <header className="provider-card__head provider-card__head--skeleton">
        <Skeleton width="84px" height={16} radius={6} />
        <Skeleton width="52px" height={18} />
      </header>
      <SkeletonBars bars={bars} />
    </section>
  );
}
