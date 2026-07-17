import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useUsageReport } from "../lib/useUsageReport";
import { LimitBar } from "../components/LimitBar";
import type { UsageSnapshot } from "../lib/types";

function WidgetGroup({ snapshot, now, locale }: { snapshot: UsageSnapshot; now: number; locale: "en" | "ko" }) {
  const { t } = useTranslation();
  const cls = snapshot.provider === "claude" ? "provider-claude" : "provider-codex";
  return (
    <section className={`widget-group ${cls}`}>
      <h2 className="widget-group__name">{t(`provider.${snapshot.provider}`)}</h2>
      {snapshot.error ? (
        <p className="widget-group__error">{t("provider.unavailable")}</p>
      ) : (
        snapshot.windows.map((w) => <LimitBar key={w.id} window={w} now={now} locale={locale} />)
      )}
    </section>
  );
}

export function WidgetApp({ locale }: { locale: "en" | "ko" }) {
  const { t } = useTranslation();
  const { report, loadFailed, now, reload } = useUsageReport();

  return (
    <div className="widget">
      <div className="widget__bar" data-tauri-drag-region>
        <span className="widget__title" data-tauri-drag-region>{t("app.title")}</span>
        <button className="widget__btn" aria-label={t("app.refresh")}
          onClick={(e) => { e.stopPropagation(); reload(); }}>⟳</button>
        <button className="widget__btn" aria-label={t("app.close")}
          onClick={(e) => { e.stopPropagation(); getCurrentWindow().hide(); }}>×</button>
      </div>
      <div className="widget__body" data-testid="widget-body" onClick={() => invoke("show_main")}>
        {report ? (
          <>
            <WidgetGroup snapshot={report.claude} now={now} locale={locale} />
            <WidgetGroup snapshot={report.codex} now={now} locale={locale} />
          </>
        ) : loadFailed ? (
          <p className="widget__error">{loadFailed}</p>
        ) : (
          <p className="widget__loading">{t("app.loading")}</p>
        )}
      </div>
    </div>
  );
}
