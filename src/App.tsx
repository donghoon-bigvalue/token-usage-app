import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { fetchUsage, onUsageUpdated } from "./lib/usage";
import { getSettings, setSettings } from "./lib/settings";
import { applyTheme } from "./theme";
import type { UsageReport, Settings } from "./lib/types";
import { Header } from "./components/Header";
import { ProviderCard } from "./components/ProviderCard";
import { SettingsPanel } from "./components/SettingsPanel";
import "./styles/theme.css";

export default function App() {
  const { i18n } = useTranslation();
  const [report, setReport] = useState<UsageReport | null>(null);
  const [settings, setSettingsState] = useState<Settings | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [showSettings, setShowSettings] = useState(false);

  // 초기 로드
  useEffect(() => {
    getSettings().then((s) => {
      setSettingsState(s);
      applyTheme(s.theme);
      i18n.changeLanguage(s.language);
    });
    fetchUsage().then(setReport);
    const un = onUsageUpdated(setReport);
    return () => { un.then((f) => f()); };
  }, [i18n]);

  // 카운트다운 틱
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const refresh = useCallback(() => { fetchUsage().then(setReport); }, []);

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
        updatedAt={report?.claude.updated_at ?? null}
        locale={locale}
      />
      {showSettings && settings && (
        <SettingsPanel settings={settings} onChange={changeSettings} onClose={() => setShowSettings(false)} />
      )}
      {report && (
        <div className="app__cards">
          <ProviderCard snapshot={report.claude} now={now} locale={locale} />
          <ProviderCard snapshot={report.codex} now={now} locale={locale} />
        </div>
      )}
    </main>
  );
}
