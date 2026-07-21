import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { useUsageReport } from "../lib/useUsageReport";
import { LimitBar } from "../components/LimitBar";
import { Spinner } from "../components/Spinner";
import type { UsageSnapshot } from "../lib/types";

// The window keeps a fixed width; only its height tracks the content so the
// widget never needs an internal scrollbar — a scrollbar in a widget is the
// exact friction we're removing.
const WIDGET_WIDTH = 260;

/// Resize the window to exactly fit the card. Runs after every render (no dep
/// array) so it re-fits when the bar count changes (error/loading states, or a
/// provider gaining an `unavailable` window) — not just on mount. Guarded on a
/// real, changed height so the countdown's per-second re-render doesn't spam
/// the IPC bridge. In jsdom there is no layout (height 0), so this is a no-op
/// under test.
function useFitWindowHeight(ref: React.RefObject<HTMLElement | null>) {
  const lastHeight = useRef(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const height = Math.ceil(el.getBoundingClientRect().height);
    if (height > 0 && height !== lastHeight.current) {
      lastHeight.current = height;
      getCurrentWindow().setSize(new LogicalSize(WIDGET_WIDTH, height));
    }
  });
}

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
  const rootRef = useRef<HTMLDivElement>(null);
  useFitWindowHeight(rootRef);
  // Spin the refresh glyph only while a press is in flight — same affordance as
  // the main window's header (reuses Spinner + its .spinner--on animation).
  const [refreshing, setRefreshing] = useState(false);
  const refresh = () => {
    if (refreshing) return;
    setRefreshing(true);
    reload().finally(() => setRefreshing(false));
  };

  return (
    <div className="widget" ref={rootRef}>
      <div className="widget__bar" data-tauri-drag-region>
        <span className="widget__title" data-tauri-drag-region>{t("app.title")}</span>
        <button className="widget__btn" aria-label={t("app.refresh")} aria-busy={refreshing}
          onClick={(e) => { e.stopPropagation(); refresh(); }}><Spinner spinning={refreshing} /></button>
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
