import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useUpdater } from "../lib/useUpdater";
import { getCurrentVersion } from "../lib/updater";
import { Spinner } from "./Spinner";
import { UpdateDialog } from "./UpdateDialog";
import type { UpdaterState } from "../lib/useUpdater";

export function UpdateSettingsSection() {
  const { t } = useTranslation();
  const { state, check, install, relaunch } = useUpdater();
  const [version, setVersion] = useState<string>("");

  useEffect(() => {
    getCurrentVersion().then(setVersion).catch(() => setVersion(""));
  }, []);

  const busy = state.kind === "checking" || state.kind === "downloading";

  // --- TEMP: 팝업 미리보기 (임시) — 실제 릴리스 없이 UpdateDialog 모양을 확인하기 위한 것.
  // 확인이 끝나면 이 블록과 아래 프리뷰 버튼/모달, import를 삭제하면 된다.
  const [preview, setPreview] = useState<UpdaterState | null>(null);
  const previewTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const previewInfo = {
    version: "1.0.5",
    notes: "• 미리보기용 예시 릴리스 노트\n• 실제 배포와 무관합니다",
    update: {} as never,
  };
  const clearPreviewTimer = () => {
    if (previewTimer.current) { clearInterval(previewTimer.current); previewTimer.current = null; }
  };
  useEffect(() => clearPreviewTimer, []);
  const closePreview = () => { clearPreviewTimer(); setPreview(null); };
  const previewInstall = () => {
    clearPreviewTimer();
    let f = 0;
    setPreview({ kind: "downloading", info: previewInfo, fraction: 0 });
    previewTimer.current = setInterval(() => {
      f += 0.1;
      if (f >= 1) { clearPreviewTimer(); setPreview({ kind: "installed" }); }
      else setPreview({ kind: "downloading", info: previewInfo, fraction: f });
    }, 200);
  };
  // --- /TEMP

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

      {/* TEMP: 팝업 미리보기 버튼 + 모달 */}
      <button
        className="settings-update__preview"
        onClick={() => setPreview({ kind: "available", info: previewInfo })}
      >
        {t("update.preview")}
      </button>
      {preview && (
        <UpdateDialog
          state={preview}
          onInstall={previewInstall}
          onDismiss={closePreview}
          onRelaunch={closePreview}
        />
      )}
      {/* /TEMP */}
    </div>
  );
}
