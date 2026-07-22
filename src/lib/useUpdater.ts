import { useCallback, useRef, useState } from "react";
import {
  checkForUpdate,
  installUpdate,
  relaunchApp,
  type UpdateInfo,
} from "./updater";
import { setDismissedVersion } from "./updater-store";

export type UpdaterState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "upToDate" }
  | { kind: "available"; info: UpdateInfo }
  | { kind: "downloading"; info: UpdateInfo; fraction: number }
  | { kind: "installed" }
  // error는 info를 잃는 상태라 forced를 따로 싣는다 — 강제 업데이트 설치가
  // 실패했을 때 "다음에 하기"가 되살아나면 안 된다.
  | { kind: "error"; message: string; forced: boolean };

export function useUpdater() {
  const [state, setState] = useState<UpdaterState>({ kind: "idle" });
  // check()가 받은 업데이트를 install()/dismiss()가 동기적으로 읽도록 ref에 보관한다.
  // setState 콜백으로 상태를 되읽는 방식은 React 19에서 updater가 호출 시점이 아닌
  // 이후 렌더에서 실행될 수 있어 신뢰할 수 없다. 소비 후에는 null로 비워
  // 완료/취소 뒤 재실행을 막는다.
  const infoRef = useRef<UpdateInfo | null>(null);
  // 다운로드 중 재진입(버튼 더블클릭 등)으로 설치가 중복 실행되는 것을 막는다.
  const busyRef = useRef(false);

  const check = useCallback(async () => {
    setState({ kind: "checking" });
    try {
      const info = await checkForUpdate();
      infoRef.current = info;
      setState(info ? { kind: "available", info } : { kind: "upToDate" });
    } catch (e) {
      // 확인 자체가 실패하면 강제 여부를 알 길이 없다 — 닫을 수 있는 오류로 둔다.
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
        forced: false,
      });
    }
  }, []);

  const install = useCallback(async () => {
    const info = infoRef.current;
    if (!info || busyRef.current) return;
    busyRef.current = true;
    setState({ kind: "downloading", info, fraction: 0 });
    try {
      await installUpdate(info, (fraction) =>
        setState((s) => (s.kind === "downloading" ? { ...s, fraction } : s))
      );
      infoRef.current = null; // 완료 — 재설치 방지
      setState({ kind: "installed" });
    } catch (e) {
      // 실패 시 infoRef는 유지해 재시도(retry)가 가능하도록 한다.
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
        forced: info.forced,
      });
    } finally {
      busyRef.current = false;
    }
  }, []);

  const dismiss = useCallback(() => {
    // 강제 업데이트는 닫을 수 없다. UI가 버튼을 감추지만, 다른 진입점이 실수로
    // 호출하더라도 상태가 idle로 빠지지 않도록 훅에서도 막는다.
    if (infoRef.current?.forced) return;
    if (infoRef.current) {
      setDismissedVersion(infoRef.current.version);
      infoRef.current = null; // 한 번만 기록 — 반복 dismiss는 no-op
    }
    setState({ kind: "idle" });
  }, []);

  const relaunch = useCallback(async () => {
    await relaunchApp();
  }, []);

  return { state, check, install, dismiss, relaunch };
}
