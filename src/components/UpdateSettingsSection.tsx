import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useUpdater } from "../lib/useUpdater";
import { getCurrentVersion } from "../lib/updater";
import { Spinner } from "./Spinner";

export function UpdateSettingsSection() {
  const { t } = useTranslation();
  const { state, check, install, relaunch } = useUpdater();
  const [version, setVersion] = useState<string>("");

  useEffect(() => {
    getCurrentVersion().then(setVersion).catch(() => setVersion(""));
  }, []);

  const busy = state.kind === "checking" || state.kind === "downloading";

  return (
    <div className="settings-update">
      <span className="settings-update__title">{t("update.section")}</span>

      {version && (
        <span className="settings-update__current">{t("update.current", { version })}</span>
      )}

      <button
        className="settings-update__check"
        onClick={() => check()}
        disabled={busy}
        aria-busy={busy}
      >
        <Spinner spinning={busy} />
        <span>{t("update.check")}</span>
      </button>

      <div className="settings-update__status" role="status">
        {state.kind === "checking" && <span>{t("update.checking")}</span>}

        {state.kind === "upToDate" && <span>{t("update.upToDate")}</span>}

        {state.kind === "available" && (
          <>
            <span>{t("update.hasUpdate", { version: state.info.version })}</span>
            <button className="settings-update__install" onClick={() => install()}>
              {t("update.install")}
            </button>
          </>
        )}

        {state.kind === "downloading" && (
          <progress
            role="progressbar"
            aria-valuenow={state.fraction >= 0 ? Math.round(state.fraction * 100) : undefined}
            aria-valuemin={0}
            aria-valuemax={100}
            value={state.fraction >= 0 ? state.fraction : undefined}
          />
        )}

        {state.kind === "installed" && (
          <>
            <span>{t("update.installed")}</span>
            <button className="settings-update__install" onClick={() => relaunch()}>
              {t("update.restart")}
            </button>
          </>
        )}

        {state.kind === "error" && <span>{t("update.error")}: {state.message}</span>}
      </div>
    </div>
  );
}
