export function formatCountdown(
  resetsAtEpoch: number,
  now: number,
  locale: "en" | "ko"
): string {
  const diff = resetsAtEpoch - now;
  if (diff <= 0) return locale === "ko" ? "리셋 중…" : "resetting…";
  const totalMin = Math.floor(diff / 60);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (locale === "ko") {
    if (d > 0) return `${d}일 ${h}시간 ${m}분 후 리셋`;
    return h > 0 ? `${h}시간 ${m}분 후 리셋` : `${m}분 후 리셋`;
  }
  if (d > 0) return `resets in ${d}d ${h}h ${m}m`;
  return h > 0 ? `resets in ${h}h ${m}m` : `resets in ${m}m`;
}
