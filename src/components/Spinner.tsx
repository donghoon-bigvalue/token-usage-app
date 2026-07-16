/**
 * Always rendered, spinning or not — swapping it in and out would change the
 * button's width mid-click. ↻ is the busy glyph; `idle` is what the button
 * means at rest — a refresh arrow on a button that doesn't refresh (e.g. a
 * download) misleadingly reads as "re-run".
 */
export function Spinner({ spinning, idle = "↻" }: { spinning: boolean; idle?: string }) {
  return (
    <span className={`spinner${spinning ? " spinner--on" : ""}`} aria-hidden="true">
      {spinning ? "↻" : idle}
    </span>
  );
}
