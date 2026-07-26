import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { UsageReport, UsageSnapshot } from "./types";

export function fetchUsage(): Promise<UsageReport> {
  return invoke<UsageReport>("get_usage");
}

export function fetchCachedUsage(): Promise<UsageReport | null> {
  return invoke<UsageReport | null>("get_cached_usage");
}

export function onUsageUpdated(cb: (r: UsageReport) => void): Promise<UnlistenFn> {
  return listen<UsageReport>("usage-updated", (e) => cb(e.payload));
}

// The generic message the backend surfaces when a provider has no usable
// credentials (missing file, or a refresh that couldn't recover a 401). This is
// the only error that should collapse a card to the sign-in prompt — every other
// error is transient and must not tell an already-signed-in user to log in.
export const AUTH_ERROR = "credentials not found";

// True only for the genuine "you need to sign in" case. A transient failure
// (network blip at launch, 5xx, rate limit) is NOT an auth error.
export function isAuthError(snapshot: { error: string | null }): boolean {
  return snapshot.error === AUTH_ERROR;
}

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

// A report where BOTH providers failed — a total cold-start failure with no
// usable data. The disk cache should still replace this; but a report with any
// usable provider data must not be clobbered by a (possibly slower) cache read.
export function isTotalFailure(r: UsageReport | null): boolean {
  return !!r && !!r.claude.error && !!r.codex.error;
}

// Decide what to show when the disk-cached snapshot resolves: keep the current
// report if it already holds usable data (so a faster live result is never
// overwritten by stale cache), otherwise paint the cache — including replacing
// a total cold-start failure with the last good snapshot.
export function applyCachePaint(
  prev: UsageReport | null,
  cached: UsageReport
): UsageReport {
  return prev && !isTotalFailure(prev) ? prev : cached;
}
