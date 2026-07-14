import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { UsageReport } from "./types";

export function fetchUsage(): Promise<UsageReport> {
  return invoke<UsageReport>("get_usage");
}

export function onUsageUpdated(cb: (r: UsageReport) => void): Promise<UnlistenFn> {
  return listen<UsageReport>("usage-updated", (e) => cb(e.payload));
}
