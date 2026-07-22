import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { UpdateDialog } from "./UpdateDialog";
import type { UpdaterState } from "../lib/useUpdater";

/**
 * 개발 빌드 전용 업데이트 팝업 미리보기.
 *
 * 실제 릴리스나 원격 정책 없이 UpdateDialog의 각 상태를 띄워 본다. 특히 강제
 * 업데이트는 config 저장소의 `minimumVersion`을 올려야 재현되는데, 그건 전 사용자에게
 * 나가는 조작이라 확인 목적으로 쓸 수 없다.
 *
 * 호출부가 `import.meta.env.DEV` 뒤에 두므로 프로덕션 번들에는 포함되지 않는다.
 * (#47의 TEMP 버튼은 이 가드가 없어 손으로 지워야 했다.)
 *
 * 라벨과 스타일 모두 이 파일 안에 둔다 — 로케일 파일과 theme.css는 트리셰이킹이
 * 되지 않아, 거기에 두면 개발자만 보는 것들이 사용자 번들에 남는다. 정작 확인
 * 대상인 UpdateDialog 자체는 그대로 i18n·theme.css를 타므로, 설정에서 언어·테마를
 * 바꾸면 팝업은 실제와 똑같이 전환된다.
 */

const styles = {
  root: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    gap: 6,
    paddingTop: 10,
    // 실제 설정 항목과 섞여 보이지 않도록 점선으로 구분한다.
    borderTop: "1px dashed var(--border)",
  },
  title: { fontSize: 11, color: "var(--muted)" },
  buttons: { display: "flex", flexWrap: "wrap", gap: 6 },
  button: { fontSize: 11, padding: "4px 8px" },
  // 강제 팝업에는 닫기 버튼이 없으므로 백드롭(z-index 1000) 위에 탈출구를 띄운다.
  exit: { position: "fixed", top: 12, right: 12, zIndex: 1001, fontSize: 11, padding: "4px 8px" },
} as const satisfies Record<string, CSSProperties>;

const previewInfo = {
  version: "1.2.0",
  notes: "• 미리보기용 예시 릴리스 노트\n• 실제 배포와 무관합니다",
  update: {} as never,
};

const force = { minimumVersion: "1.2.0", messages: null };
const forceWithMessage = {
  minimumVersion: "1.2.0",
  messages: {
    ko: "서비스 점검에 따라 최신 버전으로 업데이트가 필요합니다. 잠시 후 다시 이용해 주세요.",
    en: "A maintenance update is required. Please update to continue.",
  },
};

const SCENARIOS = [
  { label: "일반", state: { kind: "available", info: previewInfo } },
  { label: "강제", state: { kind: "available", info: previewInfo, force } },
  { label: "강제 · 받을 것 없음", state: { kind: "blocked", force } },
  { label: "강제 · 정책 문구", state: { kind: "blocked", force: forceWithMessage } },
] as const satisfies readonly { label: string; state: UpdaterState }[];

export function UpdatePreview() {
  const [preview, setPreview] = useState<UpdaterState | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimer = () => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
  };
  useEffect(() => clearTimer, []);

  const close = useCallback(() => { clearTimer(); setPreview(null); }, []);

  // 강제 팝업에는 닫기 버튼이 없다 — 미리보기에서 갇히지 않도록 Esc를 열어 둔다.
  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview, close]);

  // 실제 다운로드 없이 진행률만 흉내 낸다. 강제 여부는 실제 훅과 마찬가지로
  // 이후 전이에도 그대로 실어야 미리보기가 실제 흐름과 어긋나지 않는다.
  const install = () => {
    clearTimer();
    const force = preview && "force" in preview ? preview.force : undefined;
    let fraction = 0;
    setPreview({ kind: "downloading", info: previewInfo, fraction: 0, force });
    timer.current = setInterval(() => {
      fraction += 0.1;
      if (fraction >= 1) { clearTimer(); setPreview({ kind: "installed", force }); }
      else setPreview({ kind: "downloading", info: previewInfo, fraction, force });
    }, 200);
  };

  return (
    <div style={styles.root}>
      <span style={styles.title}>업데이트 팝업 미리보기 (개발 전용)</span>
      <div style={styles.buttons}>
        {SCENARIOS.map((s) => (
          <button key={s.label} style={styles.button} onClick={() => setPreview(s.state)}>
            {s.label}
          </button>
        ))}
      </div>
      {preview && (
        <>
          <UpdateDialog state={preview} onInstall={install} onDismiss={close} onRelaunch={close} />
          <button style={styles.exit} onClick={close}>
            미리보기 종료 (Esc)
          </button>
        </>
      )}
    </div>
  );
}
