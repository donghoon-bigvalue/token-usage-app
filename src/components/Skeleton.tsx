/**
 * A shimmer placeholder block. Purely decorative — callers put `role="status"`
 * on the container so screen readers hear "loading" once, not once per block.
 */
export function Skeleton({
  width,
  height = 12,
  radius = 999,
}: {
  width: string;
  height?: number;
  radius?: number;
}) {
  return (
    <span
      className="skeleton"
      aria-hidden="true"
      style={{ width, height, borderRadius: radius }}
    />
  );
}
