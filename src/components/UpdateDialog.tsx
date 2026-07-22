import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { UpdaterState } from "../lib/useUpdater";

const RELEASES_URL = "https://github.com/donghoon-bigvalue/token-usage-app/releases";

export function UpdateDialog({
  state,
  onInstall,
  onDismiss,
  onRelaunch,
}: {
  state: UpdaterState;
  onInstall: () => void;
  onDismiss: () => void;
  onRelaunch: () => void;
}) {
  const { t } = useTranslation();
  if (
    state.kind === "idle" ||
    state.kind === "checking" ||
    state.kind === "upToDate"
  ) {
    return null;
  }

  return (
    <div className="update-dialog__backdrop" role="dialog" aria-modal="true" aria-label={t("update.title")}>
      <div className="update-dialog">
        <h2 className="update-dialog__title">{t("update.title")}</h2>

        {state.kind === "available" && (
          <>
            <p>{t("update.available", { version: state.info.version })}</p>
            <p>
              <a
                className="update-dialog__link"
                href={RELEASES_URL}
                onClick={(e) => { e.preventDefault(); openUrl(RELEASES_URL); }}
              >
                {t("update.releaseNotes")}
              </a>
            </p>
            <div className="update-dialog__actions">
              <button className="update-dialog__primary" onClick={onInstall}>{t("update.install")}</button>
              <button onClick={onDismiss}>{t("update.later")}</button>
            </div>
          </>
        )}

        {state.kind === "downloading" && (
          <>
            <p>{t("update.downloading")}</p>
            <progress
              role="progressbar"
              aria-valuenow={state.fraction >= 0 ? Math.round(state.fraction * 100) : undefined}
              aria-valuemin={0}
              aria-valuemax={100}
              value={state.fraction >= 0 ? state.fraction : undefined}
            />
          </>
        )}

        {state.kind === "installed" && (
          <>
            <p>{t("update.installed")}</p>
            <div className="update-dialog__actions">
              <button className="update-dialog__primary" onClick={onRelaunch}>{t("update.restart")}</button>
            </div>
          </>
        )}

        {state.kind === "error" && (
          <>
            <p>{t("update.error")}: {state.message}</p>
            <div className="update-dialog__actions">
              <button className="update-dialog__primary" onClick={onInstall}>{t("update.retry")}</button>
              <button onClick={onDismiss}>{t("update.later")}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
