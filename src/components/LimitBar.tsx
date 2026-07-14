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

  if (!window.available) {
    return (
      <div className="limit-bar limit-bar--unavailable">
        <div className="limit-bar__row">
          <span className="limit-bar__label">{label}</span>
          <span className="limit-bar__muted">{t("provider.unavailable")}</span>
        </div>
        <div className="limit-bar__track"><div data-testid="bar-fill" className="limit-bar__fill" style={{ width: "0%" }} /></div>
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
      {window.resets_at != null && (
        <div className="limit-bar__reset">{formatCountdown(window.resets_at, now, locale)}</div>
      )}
    </div>
  );
}
