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

// Pinned to en-US rather than the host locale: the WebView resolved to one that
// doesn't group, so token counts rendered as 4315471877. Korean groups numbers
// the same way (comma groups, dot decimal), so one locale serves both UI
// languages — and it matches the workbook's #,##0 columns.
const TOKENS = new Intl.NumberFormat("en-US");
const USD = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatTokens(n: number): string {
  return TOKENS.format(n);
}

export function formatUsd(n: number | null): string {
  if (n === null) return "—";
  return `$${USD.format(n)}`;
}

/// Human "N ago" for a cached snapshot's age. Coarse on purpose — the badge
/// only needs to convey freshness, not exact seconds.
export function formatRelativeAge(
  epochSeconds: number,
  nowSeconds: number,
  locale: "en" | "ko"
): string {
  const diff = Math.max(0, nowSeconds - epochSeconds);
  const min = Math.floor(diff / 60);
  if (min < 1) return locale === "ko" ? "방금" : "just now";
  if (min < 60) return locale === "ko" ? `${min}분 전` : `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return locale === "ko" ? `${h}시간 전` : `${h}h ago`;
  const d = Math.floor(h / 24);
  return locale === "ko" ? `${d}일 전` : `${d}d ago`;
}
