/**
 * Always rendered, spinning or not — swapping it in and out would change the
 * button's width mid-click.
 */
export function Spinner({ spinning }: { spinning: boolean }) {
  return (
    <span className={`spinner${spinning ? " spinner--on" : ""}`} aria-hidden="true">
      ↻
    </span>
  );
}
