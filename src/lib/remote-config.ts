/**
 * 원격 강제 업데이트 정책 (킬 스위치).
 *
 * 앱 릴리스와 무관하게 "이 버전 미만은 못 쓰게 한다"를 바꿀 수 있어야 하므로,
 * 정책은 별도 공개 저장소의 JSON 파일 하나로 관리한다. 파일을 고쳐 push하면
 * 다음 실행부터(raw CDN 캐시 최대 5분) 적용된다.
 */

export const CONFIG_URL =
  "https://raw.githubusercontent.com/donghoon-bigvalue/token-usage-app-config/main/force-update.json";

/** 원격 정책을 앱이 쓰는 모양으로 정규화한 값. */
export type ForcePolicy = {
  minimumVersion: string;
  /** 언어 코드 → 문구. 없으면 앱 기본 문구를 쓴다. */
  messages: Record<string, string> | null;
};

const FETCH_TIMEOUT_MS = 5000;

/** `1.2.10` 형태 비교. 프리릴리스 접미사는 무시한다. a<b면 음수. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) =>
    v.trim().split("-")[0].split(".").map((n) => Number.parseInt(n, 10));
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const l = x[i] ?? 0;
    const r = y[i] ?? 0;
    if (!Number.isFinite(l) || !Number.isFinite(r)) return NaN;
    if (l !== r) return l - r;
  }
  return 0;
}

/**
 * 현재 버전이 최소 요구 버전 미만인지.
 * 둘 중 하나라도 해석되지 않으면 false — 정책 파싱 실패가 앱을 잠그면 안 된다.
 */
export function isBelowMinimum(current: string, minimum: string): boolean {
  const diff = compareVersions(current, minimum);
  return Number.isFinite(diff) && diff < 0;
}

/**
 * 정책을 가져온다. 오프라인·404·형식 오류 등 어떤 실패든 null(=강제 없음).
 * 네트워크 사고로 앱을 못 쓰게 만드는 쪽이 구버전을 잠시 더 쓰게 두는 것보다 나쁘다.
 */
export async function fetchForcePolicy(): Promise<ForcePolicy | null> {
  try {
    // CDN(max-age=300)은 어쩔 수 없지만, 브라우저 캐시까지 얹히면 킬 스위치가
    // 훨씬 늦게 도달한다.
    const res = await fetch(CONFIG_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    return normalizePolicy(data);
  } catch {
    return null;
  }
}

/** 알 수 없는 필드는 무시 — 정책 파일이 앞서 나가도 구버전 앱이 깨지지 않는다. */
export function normalizePolicy(data: unknown): ForcePolicy | null {
  if (typeof data !== "object" || data === null) return null;
  const { minimumVersion, message } = data as Record<string, unknown>;
  if (typeof minimumVersion !== "string" || minimumVersion.trim() === "") return null;
  let messages: Record<string, string> | null = null;
  if (typeof message === "object" && message !== null) {
    const entries = Object.entries(message).filter(
      (e): e is [string, string] => typeof e[1] === "string" && e[1].trim() !== ""
    );
    if (entries.length > 0) messages = Object.fromEntries(entries);
  }
  return { minimumVersion, messages };
}

/** `ko-KR`처럼 지역이 붙은 코드도 받아 정책 문구를 고른다. 없으면 null. */
export function pickMessage(
  messages: Record<string, string> | null | undefined,
  language: string
): string | null {
  if (!messages) return null;
  return messages[language] ?? messages[language.split("-")[0]] ?? messages.en ?? null;
}
