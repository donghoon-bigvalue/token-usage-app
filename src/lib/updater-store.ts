const LAST_CHECK_KEY = "updater.lastCheckAt";
const DISMISSED_KEY = "updater.dismissedVersion";
const DAY_MS = 86_400_000;

/** 자동 확인 스로틀: 한 번도 안 했거나 24시간이 지났으면 true. */
export function shouldAutoCheck(now: number, lastCheckAt: number | null): boolean {
  return lastCheckAt == null || now - lastCheckAt >= DAY_MS;
}

/** dismissed와 다른 버전일 때만 자동 팝업을 띄운다. */
export function shouldPrompt(version: string, dismissedVersion: string | null): boolean {
  return version !== dismissedVersion;
}

export function getLastCheckAt(): number | null {
  const v = localStorage.getItem(LAST_CHECK_KEY);
  return v == null ? null : Number(v);
}

export function setLastCheckAt(ts: number): void {
  localStorage.setItem(LAST_CHECK_KEY, String(ts));
}

export function getDismissedVersion(): string | null {
  return localStorage.getItem(DISMISSED_KEY);
}

export function setDismissedVersion(version: string): void {
  localStorage.setItem(DISMISSED_KEY, version);
}
