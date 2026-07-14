import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { UsageReport, UsageSnapshot } from "./types";

export function fetchUsage(): Promise<UsageReport> {
  return invoke<UsageReport>("get_usage");
}

export function onUsageUpdated(cb: (r: UsageReport) => void): Promise<UnlistenFn> {
  return listen<UsageReport>("usage-updated", (e) => cb(e.payload));
}

// The generic message the backend surfaces when a provider has no usable
// credentials (missing file, or a refresh that couldn't recover a 401). This is
// the only error that should collapse a card to the sign-in prompt.
const AUTH_ERROR = "credentials not found";

function mergeSnapshot(prev: UsageSnapshot | undefined, next: UsageSnapshot): UsageSnapshot {
  // Preserve the last successful snapshot across a *transient* failure (rate
  // limit, network blip, 5xx) so one bad refresh never wipes a working chart.
  // An auth error still replaces it — the user genuinely needs to sign in.
  if (next.error && next.error !== AUTH_ERROR && prev && !prev.error) {
    return prev;
  }
  return next;
}

/// Fold a freshly-received report into the currently-displayed one, keeping the
/// last good data per provider when the new one failed transiently.
export function mergeReport(prev: UsageReport | null, next: UsageReport): UsageReport {
  return {
    claude: mergeSnapshot(prev?.claude, next.claude),
    codex: mergeSnapshot(prev?.codex, next.codex),
  };
}
