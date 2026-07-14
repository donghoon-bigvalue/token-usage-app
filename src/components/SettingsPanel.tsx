import { useTranslation } from "react-i18next";
import type { Settings } from "../lib/types";

export function SettingsPanel({
  settings,
  onChange,
  onClose,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="settings-panel">
      <label>
        {t("settings.language")}
        <select
          aria-label={t("settings.language")}
          value={settings.language}
          onChange={(e) => onChange({ ...settings, language: e.target.value as Settings["language"] })}
        >
          <option value="en">English</option>
          <option value="ko">한국어</option>
        </select>
      </label>
      <label>
        {t("settings.theme")}
        <select
          aria-label={t("settings.theme")}
          value={settings.theme}
          onChange={(e) => onChange({ ...settings, theme: e.target.value as Settings["theme"] })}
        >
          <option value="light">{t("settings.light")}</option>
          <option value="dark">{t("settings.dark")}</option>
          <option value="system">{t("settings.system")}</option>
        </select>
      </label>
      <label>
        {t("settings.interval")}
        <input
          aria-label={t("settings.interval")}
          type="number"
          min={15}
          value={settings.refresh_interval_secs}
          onChange={(e) => onChange({ ...settings, refresh_interval_secs: Number(e.target.value) })}
        />
      </label>
      <button onClick={onClose}>×</button>
    </div>
  );
}
