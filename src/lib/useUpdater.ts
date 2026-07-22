import { useCallback, useState } from "react";
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

  const check = useCallback(async () => {
    setState({ kind: "checking" });
    try {
      const info = await checkForUpdate();
      setState(info ? { kind: "available", info } : { kind: "upToDate" });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  const install = useCallback(async () => {
    setState((s) =>
      s.kind === "available" || s.kind === "downloading"
        ? { kind: "downloading", info: s.info, fraction: 0 }
        : s
    );
    try {
      const info = await getActiveInfo();
      if (!info) return;
      await installUpdate(info, (fraction) =>
        setState((s) =>
          s.kind === "downloading" ? { ...s, fraction } : s
        )
      );
      setState({ kind: "installed" });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }

    function getActiveInfo(): UpdateInfo | null {
      let found: UpdateInfo | null = null;
      setState((s) => {
        if (s.kind === "downloading" || s.kind === "available") found = s.info;
        return s;
      });
      return found;
    }
  }, []);

  const dismiss = useCallback(() => {
    setState((s) => {
      if (s.kind === "available") setDismissedVersion(s.info.version);
      return { kind: "idle" };
    });
  }, []);

  const relaunch = useCallback(async () => {
    await relaunchApp();
  }, []);

  return { state, check, install, dismiss, relaunch };
}
