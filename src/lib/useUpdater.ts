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
  | { kind: "error"; message: string };

export function useUpdater() {
  const [state, setState] = useState<UpdaterState>({ kind: "idle" });
  // check()가 받은 업데이트를 install()/dismiss()가 동기적으로 읽도록 ref에 보관한다.
  // setState 콜백으로 상태를 되읽는 방식은 React 19에서 updater가 호출 시점이 아닌
  // 이후 렌더에서 실행될 수 있어 신뢰할 수 없다.
  const infoRef = useRef<UpdateInfo | null>(null);

  const check = useCallback(async () => {
    setState({ kind: "checking" });
    try {
      const info = await checkForUpdate();
      infoRef.current = info;
      setState(info ? { kind: "available", info } : { kind: "upToDate" });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  const install = useCallback(async () => {
    const info = infoRef.current;
    if (!info) return;
    setState({ kind: "downloading", info, fraction: 0 });
    try {
      await installUpdate(info, (fraction) =>
        setState((s) => (s.kind === "downloading" ? { ...s, fraction } : s))
      );
      setState({ kind: "installed" });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  const dismiss = useCallback(() => {
    if (infoRef.current) setDismissedVersion(infoRef.current.version);
    setState({ kind: "idle" });
  }, []);

  const relaunch = useCallback(async () => {
    await relaunchApp();
  }, []);

  return { state, check, install, dismiss, relaunch };
}
