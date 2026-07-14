import { useTranslation } from "react-i18next";

export function Header({
  onRefresh,
  onOpenSettings,
  updatedAt,
  locale,
  view,
  onViewChange,
}: {
  onRefresh: () => void;
  onOpenSettings: () => void;
  updatedAt: number | null;
  locale: "en" | "ko";
  view: "limits" | "history";
  onViewChange: (v: "limits" | "history") => void;
}) {
  const { t } = useTranslation();
  const timeStr = updatedAt
    ? new Date(updatedAt * 1000).toLocaleTimeString(locale === "ko" ? "ko-KR" : "en-US")
    : "—";
  return (
    <header className="app-header">
      <h1 className="app-header__title">{t("app.title")}</h1>
      <div className="view-toggle">
        <button
          className={view === "limits" ? "active" : ""}
          onClick={() => onViewChange("limits")}
        >{t("history.limitsTab")}</button>
        <button
          className={view === "history" ? "active" : ""}
          onClick={() => onViewChange("history")}
        >{t("history.tab")}</button>
      </div>
      <div className="app-header__actions">
        <span className="app-header__updated">{t("app.lastUpdated", { time: timeStr })}</span>
        <button onClick={onRefresh}>{t("app.refresh")}</button>
        <button onClick={onOpenSettings} aria-label={t("app.settings")}>⚙</button>
      </div>
    </header>
  );
}
