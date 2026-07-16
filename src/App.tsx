import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { fetchUsage, onUsageUpdated, mergeReport } from "./lib/usage";
import { getSettings, setSettings } from "./lib/settings";
import { applyTheme } from "./theme";
import type { UsageReport, Settings } from "./lib/types";
import { Header } from "./components/Header";
import { ProviderCard } from "./components/ProviderCard";
import { ProviderCardSkeleton } from "./components/ProviderCardSkeleton";
import { SettingsPanel } from "./components/SettingsPanel";
import UsageHistoryView from "./components/UsageHistoryView";
import "./styles/theme.css";

export default function App() {
  const { t, i18n } = useTranslation();
  const [report, setReport] = useState<UsageReport | null>(null);
  const [settings, setSettingsState] = useState<Settings | null>(null);
  const [loadFailed, setLoadFailed] = useState<string | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [showSettings, setShowSettings] = useState(false);
  const [view, setView] = useState<"limits" | "history">("limits");
  // Bumped to ask UsageHistoryView for a fresh scan; the Header's refresh button
  // is the single refresh affordance and dispatches by whichever tab is open.
  const [historyRefresh, setHistoryRefresh] = useState(0);
  // Each tab reports its own freshness: limits carry a snapshot time, history a
  // scan time, and they move independently.
  const [historyScannedAt, setHistoryScannedAt] = useState<number | null>(null);

  // 성공한 스냅샷을 provider별로 유지 — 일시적 실패(429 등)가 차트를 지우지 않도록.
  const applyReport = useCallback((next: UsageReport) => {
    setReport((prev) => mergeReport(prev, next));
  }, []);

  // The one place limits are fetched — a rejection here used to vanish, leaving
  // the card area blank forever. Now it resolves the loading state instead.
  const load = useCallback(
    () =>
      fetchUsage()
        .then((r) => { applyReport(r); setLoadFailed(null); })
        .catch((e) => setLoadFailed(e instanceof Error ? e.message : String(e))),
    [applyReport]
  );

  // 초기 로드
  useEffect(() => {
    getSettings().then((s) => {
      setSettingsState(s);
      applyTheme(s.theme);
      i18n.changeLanguage(s.language);
    });
    load();
    const un = onUsageUpdated(applyReport);
    return () => { un.then((f) => f()); };
  }, [i18n, applyReport, load]);

  // 카운트다운 틱
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const refresh = useCallback(() => {
    if (view === "history") setHistoryRefresh((n) => n + 1);
    else load();
  }, [view, load]);

  const changeSettings = useCallback((next: Settings) => {
    setSettingsState(next);
    applyTheme(next.theme);
    i18n.changeLanguage(next.language);
    setSettings(next).then(setSettingsState);
  }, [i18n]);

  const locale = (settings?.language ?? "en") as "en" | "ko";

  return (
    <main className="app">
      <Header
        onRefresh={refresh}
        onOpenSettings={() => setShowSettings((v) => !v)}
        updatedAt={view === "history" ? historyScannedAt : report?.claude.updated_at ?? null}
        locale={locale}
        view={view}
        onViewChange={setView}
      />
      {showSettings && settings && (
        <SettingsPanel settings={settings} onChange={changeSettings} onClose={() => setShowSettings(false)} />
      )}
      {view === "limits" ? (
        report ? (
          <div className="app__cards">
            <ProviderCard snapshot={report.claude} now={now} locale={locale} />
            <ProviderCard snapshot={report.codex} now={now} locale={locale} />
          </div>
        ) : loadFailed ? (
          <p className="error-banner" role="alert">{t("app.loadFailed")}: {loadFailed}</p>
        ) : (
          <div className="app__cards" role="status" aria-label={t("app.loading")}>
            <ProviderCardSkeleton bars={3} />
            <ProviderCardSkeleton bars={2} />
          </div>
        )
      ) : (
        <UsageHistoryView refreshSignal={historyRefresh} onScannedAt={setHistoryScannedAt} />
      )}
    </main>
  );
}
