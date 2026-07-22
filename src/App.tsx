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
import { useUpdater } from "./lib/useUpdater";
import { UpdateDialog } from "./components/UpdateDialog";
import {
  shouldAutoCheck,
  shouldPrompt,
  getLastCheckAt,
  setLastCheckAt,
  getDismissedVersion,
} from "./lib/updater-store";
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
  const [limitsRefreshing, setLimitsRefreshing] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  // Only a press should spin the button; a cold load shows a skeleton instead.
  const [refreshPressed, setRefreshPressed] = useState(false);
  const updater = useUpdater();

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

  // 하루 1회 자동 업데이트 확인. 결과와 무관하게 확인 시각을 기록한다.
  useEffect(() => {
    if (!shouldAutoCheck(Date.now(), getLastCheckAt())) return;
    updater.check().finally(() => setLastCheckAt(Date.now()));
    // updater.check는 안정적인 useCallback이라 마운트 시 1회만 실행하면 된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 카운트다운 틱
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const refresh = useCallback(() => {
    if (view === "history") {
      setRefreshPressed(true);
      setHistoryRefresh((n) => n + 1);
    } else {
      setLimitsRefreshing(true);
      load().finally(() => setLimitsRefreshing(false));
    }
  }, [view, load]);

  // Fires for cold loads too — App decides what it means. Task 5 reuses
  // historyBusy for the header's time placeholder.
  const handleHistoryLoading = useCallback((busy: boolean) => {
    setHistoryBusy(busy);
    if (!busy) setRefreshPressed(false);
  }, []);

  // Leaving the history tab unmounts the view mid-scan, and these flags are
  // ours, not its — without this a press abandoned by a tab switch stays
  // pending and spins the button on the next cold load, which the user never
  // pressed.
  useEffect(() => {
    if (view !== "history") {
      setHistoryBusy(false);
      setRefreshPressed(false);
    }
  }, [view]);

  // Switching to history mounts a child whose loading effect hasn't run yet on
  // that first render, so historyBusy is still false for one frame — long enough
  // for the header to flash "Updated —" before the skeleton takes over. Seed the
  // busy flag optimistically here; the child confirms it (still true) or clears
  // it in its .finally().
  const changeView = useCallback((next: "limits" | "history") => {
    if (next === view) return; // a redundant click on the active tab remounts nothing
    if (next === "history") setHistoryBusy(true);
    setView(next);
  }, [view]);

  const changeSettings = useCallback((next: Settings) => {
    setSettingsState(next);
    applyTheme(next.theme);
    i18n.changeLanguage(next.language);
    setSettings(next).then(setSettingsState);
  }, [i18n]);

  const locale = (settings?.language ?? "en") as "en" | "ko";

  return (
    <main className="app">
      {(() => {
        const s = updater.state;
        const suppressed =
          s.kind === "available" && !shouldPrompt(s.info.version, getDismissedVersion());
        return suppressed ? null : (
          <UpdateDialog
            state={s}
            onInstall={updater.install}
            onDismiss={updater.dismiss}
            onRelaunch={updater.relaunch}
          />
        );
      })()}
      <Header
        onRefresh={refresh}
        onOpenSettings={() => setShowSettings((v) => !v)}
        updatedAt={view === "history" ? historyScannedAt : report?.claude.updated_at ?? null}
        locale={locale}
        view={view}
        onViewChange={changeView}
        refreshing={view === "history" ? historyBusy && refreshPressed : limitsRefreshing}
        loading={view === "history" ? historyBusy : report === null && loadFailed === null}
      />
      {showSettings && settings && (
        <SettingsPanel settings={settings} onChange={changeSettings} onClose={() => setShowSettings(false)} />
      )}
      {view === "limits" ? (
        report ? (
          <>
            <div className="app__cards">
              <ProviderCard snapshot={report.claude} now={now} locale={locale} />
              <ProviderCard snapshot={report.codex} now={now} locale={locale} />
            </div>
            {/* A refresh that fails while a snapshot is already on screen used to
                vanish: loadFailed was only rendered on the report-less branch
                below, so the stale cards sat there with no signal. Mirror the
                History tab and surface it as an alert beneath the cards. */}
            {loadFailed && (
              <p className="error-banner" role="alert">{t("app.refreshFailed")}: {loadFailed}</p>
            )}
          </>
        ) : loadFailed ? (
          <p className="error-banner" role="alert">{t("app.loadFailed")}: {loadFailed}</p>
        ) : (
          // bars are the success-case window counts (Claude 3, Codex 2). Known
          // tradeoff: a provider that resolves to an error renders a shorter
          // EmptyState, so a cold load ending in an error shifts the layout —
          // unavoidable here, since the error isn't known until the fetch lands.
          <div className="app__cards" role="status" aria-label={t("app.loading")}>
            <ProviderCardSkeleton bars={3} />
            <ProviderCardSkeleton bars={2} />
          </div>
        )
      ) : (
        <UsageHistoryView
          refreshSignal={historyRefresh}
          onScannedAt={setHistoryScannedAt}
          onLoadingChange={handleHistoryLoading}
        />
      )}
    </main>
  );
}
