import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { pickMessage } from "../lib/remote-config";
import type { UpdaterState, Force } from "../lib/useUpdater";

const RELEASES_URL = "https://github.com/donghoon-bigvalue/token-usage-app/releases";

/** 강제 정책이 실려 있으면 그 값을, 아니면 undefined. 존재 = 닫을 수 없음. */
function forceOf(state: UpdaterState): Force | undefined {
  switch (state.kind) {
    case "available":
    case "downloading":
    case "installed":
    case "error":
      return state.force;
    case "blocked":
      return state.force;
    default:
      return undefined;
  }
}

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
  const { t, i18n } = useTranslation();
  if (
    state.kind === "idle" ||
    state.kind === "checking" ||
    state.kind === "upToDate"
  ) {
    return null;
  }

  const force = forceOf(state);
  const title = force ? t("update.forcedTitle") : t("update.title");
  // 원격 정책이 문구를 주면 그것을 쓰고, 없으면 앱 기본 문구.
  const forcedBody = force
    ? pickMessage(force.messages, i18n.language) ?? t("update.forced")
    : null;
  // 인앱 업데이터가 고장나서 강제 릴리스를 내는 경우도 있으므로, 강제 모드에서는
  // 항상 동작하는 경로(릴리스 페이지 직접 다운로드)를 먼저 제시한다.
  const openReleases = () => openUrl(RELEASES_URL);

  return (
    <div
      className={`update-dialog__backdrop${force ? " update-dialog__backdrop--forced" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="update-dialog">
        <h2 className="update-dialog__title">{title}</h2>

        {state.kind === "available" && (
          <>
            {force ? (
              <>
                <p>{forcedBody}</p>
                <p>{t("update.available", { version: state.info.version })}</p>
              </>
            ) : (
              <p>{t("update.available", { version: state.info.version })}</p>
            )}
            <p>
              <a
                className="update-dialog__link"
                href={RELEASES_URL}
                onClick={(e) => { e.preventDefault(); openReleases(); }}
              >
                {t("update.releaseNotes")}
              </a>
            </p>
            <div className="update-dialog__actions">
              {force ? (
                <>
                  <button className="update-dialog__primary" onClick={openReleases}>
                    {t("update.openDownload")}
                  </button>
                  <button onClick={onInstall}>{t("update.install")}</button>
                </>
              ) : (
                <>
                  <button className="update-dialog__primary" onClick={onInstall}>{t("update.install")}</button>
                  <button onClick={onDismiss}>{t("update.later")}</button>
                </>
              )}
            </div>
          </>
        )}

        {/* 강제인데 인앱으로 받을 업데이트가 없는 상태 — 다운로드 페이지만 안내한다. */}
        {state.kind === "blocked" && (
          <>
            <p>{forcedBody}</p>
            <div className="update-dialog__actions">
              <button className="update-dialog__primary" onClick={openReleases}>
                {t("update.openDownload")}
              </button>
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
              {/* 강제 업데이트는 실패해도 물러설 곳이 없다 — 닫기 대신 직접 받을
                  경로를 준다. */}
              {force ? (
                <button onClick={openReleases}>{t("update.openDownload")}</button>
              ) : (
                <button onClick={onDismiss}>{t("update.later")}</button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
