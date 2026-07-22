import { useCallback, useRef, useState } from "react";
import {
  checkForUpdate,
  installUpdate,
  relaunchApp,
  getCurrentVersion,
  type UpdateInfo,
} from "./updater";
import { setDismissedVersion } from "./updater-store";
import { fetchForcePolicy, isBelowMinimum, type ForcePolicy } from "./remote-config";

/** 강제 업데이트가 걸린 상태에만 실린다 — 존재 자체가 "닫을 수 없음"을 뜻한다. */
export type Force = ForcePolicy;

export type UpdaterState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "upToDate" }
  | { kind: "available"; info: UpdateInfo; force?: Force }
  | { kind: "downloading"; info: UpdateInfo; fraction: number; force?: Force }
  | { kind: "installed" }
  // 강제인데 받을 업데이트가 없는 경우 — 정책이 아직 퍼블리시되지 않은 버전을
  // 요구하거나 확인이 실패한 상황. 인앱 설치 대신 다운로드 페이지만 안내한다.
  | { kind: "blocked"; force: Force }
  | { kind: "error"; message: string; force?: Force };

export function useUpdater() {
  const [state, setState] = useState<UpdaterState>({ kind: "idle" });
  // check()가 받은 업데이트를 install()/dismiss()가 동기적으로 읽도록 ref에 보관한다.
  // setState 콜백으로 상태를 되읽는 방식은 React 19에서 updater가 호출 시점이 아닌
  // 이후 렌더에서 실행될 수 있어 신뢰할 수 없다. 소비 후에는 null로 비워
  // 완료/취소 뒤 재실행을 막는다.
  const infoRef = useRef<UpdateInfo | null>(null);
  // 다운로드 중 재진입(버튼 더블클릭 등)으로 설치가 중복 실행되는 것을 막는다.
  const busyRef = useRef(false);
  // 강제 정책은 한 번 켜지면 이 세션 내내 유지된다 — 이후 상태 전이(다운로드,
  // 실패)에도 계속 실려 "다음에 하기"가 되살아나지 않게 한다.
  const forceRef = useRef<Force | null>(null);

  const force = () => forceRef.current ?? undefined;

  const check = useCallback(async () => {
    setState({ kind: "checking" });
    try {
      const info = await checkForUpdate();
      infoRef.current = info;
      setState(
        info
          ? { kind: "available", info, force: force() }
          : forceRef.current
            // 강제인데 받을 게 없다 — 최신이라고 놓아주면 정책이 무의미해진다.
            ? { kind: "blocked", force: forceRef.current }
            : { kind: "upToDate" }
      );
    } catch (e) {
      setState(
        forceRef.current
          // 강제 상태에서 확인이 실패하면 인앱 경로가 없다 — 수동 다운로드로 보낸다.
          ? { kind: "blocked", force: forceRef.current }
          : { kind: "error", message: e instanceof Error ? e.message : String(e) }
      );
    }
  }, []);

  /**
   * 원격 정책을 확인해 강제 업데이트 여부를 정한다. 강제면 스로틀과 무관하게
   * 업데이트 확인까지 이어서 수행한다 — 그래야 인앱 설치 버튼을 줄 수 있다.
   * 강제가 걸렸으면 true. 실패는 모두 fail-open(false).
   */
  const enforce = useCallback(async (): Promise<boolean> => {
    const [policy, current] = await Promise.all([
      fetchForcePolicy(),
      getCurrentVersion().catch(() => null),
    ]);
    if (!policy || !current || !isBelowMinimum(current, policy.minimumVersion)) return false;
    forceRef.current = policy;
    await check();
    return true;
  }, [check]);

  const install = useCallback(async () => {
    const info = infoRef.current;
    if (!info || busyRef.current) return;
    busyRef.current = true;
    setState({ kind: "downloading", info, fraction: 0, force: force() });
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
        force: force(),
      });
    } finally {
      busyRef.current = false;
    }
  }, []);

  const dismiss = useCallback(() => {
    // 강제 업데이트는 닫을 수 없다. UI가 버튼을 감추지만, 다른 진입점이 실수로
    // 호출하더라도 상태가 idle로 빠지지 않도록 훅에서도 막는다.
    if (forceRef.current) return;
    if (infoRef.current) {
      setDismissedVersion(infoRef.current.version);
      infoRef.current = null; // 한 번만 기록 — 반복 dismiss는 no-op
    }
    setState({ kind: "idle" });
  }, []);

  const relaunch = useCallback(async () => {
    await relaunchApp();
  }, []);

  return { state, check, enforce, install, dismiss, relaunch };
}
