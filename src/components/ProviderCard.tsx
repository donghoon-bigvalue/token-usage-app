import { useTranslation } from "react-i18next";
import type { UsageSnapshot } from "../lib/types";
import { isAuthError } from "../lib/usage";
import { formatRelativeAge } from "../lib/format";
import { LimitBar } from "./LimitBar";
import { EmptyState } from "./EmptyState";
import { SkeletonBars } from "./SkeletonBars";
import { Spinner } from "./Spinner";

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
          <span className="provider-card__cached">
            {t("app.cached")} · {formatRelativeAge(snapshot.updated_at, now, locale)}
          </span>
        )}
      </header>
      {snapshot.error ? (
        // Only a genuine auth error asks the user to sign in. A transient
        // failure (a network blip at launch, a 5xx, a rate limit) must not —
        // the user is already signed in; the poller and next refresh recover.
        // For that case, show shimmering bars + a "retrying" caption: it reads
        // as work-in-progress and reserves the real bars' height, so data swaps
        // in without shifting the layout.
        isAuthError(snapshot) ? (
          <EmptyState providerName={providerName} />
        ) : (
          <div role="status">
            <SkeletonBars bars={snapshot.windows.length || (snapshot.provider === "claude" ? 3 : 2)} />
            <p className="provider-card__retry">
              <Spinner spinning /> {t("provider.retrying")}
            </p>
          </div>
        )
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
