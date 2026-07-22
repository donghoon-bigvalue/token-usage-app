const LAST_CHECK_KEY = "updater.lastCheckAt";
const DISMISSED_KEY = "updater.dismissedVersion";
const DAY_MS = 86_400_000;

/** 자동 확인 스로틀: 한 번도 안 했거나 24시간이 지났으면 true. */
export function shouldAutoCheck(now: number, lastCheckAt: number | null): boolean {
  return lastCheckAt == null || now - lastCheckAt >= DAY_MS;
}

/**
 * dismissed와 다른 버전일 때만 자동 팝업을 띄운다.
 * 강제 업데이트는 dismissed 기록을 무시한다 — 강제 지정 이전에 같은 버전을
 * "다음에 하기"로 넘긴 적이 있어도 다시 띄워야 하기 때문.
 */
export function shouldPrompt(
  version: string,
  dismissedVersion: string | null,
  forced = false
): boolean {
  return forced || version !== dismissedVersion;
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
