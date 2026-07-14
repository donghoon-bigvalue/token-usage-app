export function formatCountdown(
  resetsAtEpoch: number,
  now: number,
  locale: "en" | "ko"
): string {
  const diff = resetsAtEpoch - now;
  if (diff <= 0) return locale === "ko" ? "리셋 중…" : "resetting…";
  const totalMin = Math.floor(diff / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (locale === "ko") {
    return h > 0 ? `${h}시간 ${m}분 후 리셋` : `${m}분 후 리셋`;
  }
  return h > 0 ? `resets in ${h}h ${m}m` : `resets in ${m}m`;
}
