import { useTranslation } from "react-i18next";
import type { LimitWindow } from "../lib/types";
import { formatCountdown } from "../lib/format";

export function LimitBar({
  window,
  now,
  locale,
}: {
  window: LimitWindow;
  now: number;
  locale: "en" | "ko";
}) {
  const { t } = useTranslation();
  const label = t(`window.${window.id}`);
  const pct = Math.max(0, Math.min(100, window.used_percent));

  // The skeleton can't know in advance which windows will be unavailable
  // (rollout accounts push an unconditional `unavailable` window for some
  // provider/plan combos), so it always reserves this line. If the real bar
  // omitted it conditionally, every unavailable or countdown-less window
  // would render shorter than the skeleton predicted. Rendering it in both
  // branches — with a non-breaking space when there's nothing to show —
  // keeps every bar the same height.
  if (!window.available) {
    return (
      <div className="limit-bar limit-bar--unavailable">
        <div className="limit-bar__row">
          <span className="limit-bar__label">{label}</span>
          <span className="limit-bar__muted">{t("provider.unavailable")}</span>
        </div>
        <div className="limit-bar__track"><div data-testid="bar-fill" className="limit-bar__fill" style={{ width: "0%" }} /></div>
        <div className="limit-bar__reset">{" "}</div>
      </div>
    );
  }

  return (
    <div className="limit-bar">
      <div className="limit-bar__row">
        <span className="limit-bar__label">{label}</span>
        <span className="limit-bar__pct">{Math.round(pct)}%</span>
      </div>
      <div className="limit-bar__track">
        <div data-testid="bar-fill" className="limit-bar__fill" style={{ width: `${pct}%`, background: "var(--accent)" }} />
      </div>
      <div className="limit-bar__reset">
        {window.resets_at != null ? formatCountdown(window.resets_at, now, locale) : " "}
      </div>
    </div>
  );
}
