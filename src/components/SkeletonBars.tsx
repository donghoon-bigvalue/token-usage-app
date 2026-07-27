import { Skeleton } from "./Skeleton";

/**
 * The shimmer stand-in for a provider's limit bars. Shared by the cold-load
 * skeleton (ProviderCardSkeleton) and the retrying state (ProviderCard) so both
 * speak the same "loading" language and — critically — reserve the same height
 * as the real bars, letting data swap in without shifting the layout. `bars`
 * differs per provider: Claude has 3 windows, Codex 2.
 */
export function SkeletonBars({ bars }: { bars: number }) {
  return (
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
  );
}
