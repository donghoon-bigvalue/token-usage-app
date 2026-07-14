import { useTranslation } from "react-i18next";
import type { UsageSnapshot } from "../lib/types";
import { LimitBar } from "./LimitBar";
import { EmptyState } from "./EmptyState";

export function ProviderCard({
  snapshot,
  now,
  locale,
}: {
  snapshot: UsageSnapshot;
  now: number;
  locale: "en" | "ko";
}) {
  const { t } = useTranslation();
  const providerName = t(`provider.${snapshot.provider}`);
  const cls = snapshot.provider === "claude" ? "provider-claude" : "provider-codex";

  return (
    <section className={`provider-card ${cls}`}>
      <header className="provider-card__head">
        <h2 className="provider-card__name">{providerName}</h2>
        {!snapshot.error && (
          <span className="provider-card__plan" style={{ background: "var(--accent)" }}>
            {snapshot.plan}
          </span>
        )}
        {snapshot.source === "cache" && !snapshot.error && (
          <span className="provider-card__cached">{t("app.cached")}</span>
        )}
      </header>
      {snapshot.error ? (
        <EmptyState providerName={providerName} />
      ) : (
        <div className="provider-card__bars">
          {snapshot.windows.map((w) => (
            <LimitBar key={w.id} window={w} now={now} locale={locale} />
          ))}
        </div>
      )}
    </section>
  );
}
