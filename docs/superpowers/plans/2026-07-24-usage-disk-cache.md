# 마지막 성공 스냅샷 디스크 캐시 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 마지막으로 성공한 사용량 스냅샷을 디스크에 저장해 두고, 다음 실행 때 캐시(캐시 시각 포함)로 즉시 보여준 뒤 백그라운드에서 라이브로 갱신한다.

**Architecture:** 백엔드에 인메모리 홀더 `LastGood`(provider별 마지막 성공분)를 두고, 시작 시 디스크에서 시딩·폴러가 매 수집마다 갱신·종료(`RunEvent::Exit`) 시 디스크에 1회 flush. 새 커맨드 `get_cached_usage`가 이를 `source=Cache`로 표시해 반환하고, 프론트는 마운트 시 캐시를 먼저 그린 뒤 라이브(`get_usage`)로 교체한다.

**Tech Stack:** Rust (Tauri v2, `tauri-plugin-store`, serde), React/TypeScript (Vitest, Testing Library).

## Global Constraints

- 이 앱은 트레이 앱이다: 창을 닫으면 숨겨지고, 완전 종료는 트레이 "종료"(`app.exit(0)`)/OS 종료 때만 일어난다. 디스크 쓰기는 종료 시 1회.
- store 접근은 기존 설정과 동일하게 `tauri-plugin-store`(`app.store(...)`), 모두 best-effort(실패해도 패닉 없음).
- 인증 에러 문자열 sentinel은 `"credentials not found"`로 프론트/백엔드가 일치(이미 존재).
- 병합 규칙: provider별로 `error.is_none()`인 스냅샷만 저장에 반영, 에러면 기존 값 유지.
- 프론트 캐시 페인트는 "아직 아무것도 못 그렸을 때만"(`prev ?? cached`) — 더 빠른 라이브 결과를 오래된 캐시로 덮지 않는다.

---

### Task 1: 백엔드 — `usage_cache` 모듈 (순수 병합/표시 로직 + I/O 헬퍼)

**Files:**
- Create: `src-tauri/src/usage_cache.rs`
- Modify: `src-tauri/src/usage.rs:3` (serde import), `src-tauri/src/usage.rs:8-9` (`UsageReport` derive)
- Modify: `src-tauri/src/lib.rs:5` (`mod usage_cache;` 선언)
- Test: `src-tauri/src/usage_cache.rs` 내부 `#[cfg(test)]`

**Interfaces:**
- Consumes: `crate::usage::UsageReport`, `crate::model::{Source, UsageSnapshot, ProviderId}`.
- Produces:
  - `pub struct LastGood(pub std::sync::Mutex<Option<UsageReport>>)` (`Default`)
  - `impl LastGood { pub fn update(&self, fresh: &UsageReport); pub fn as_cache(&self) -> Option<UsageReport>; }`
  - `pub fn merge_persisted(prev: Option<&UsageReport>, fresh: &UsageReport) -> UsageReport`
  - `pub fn read_disk(app: &tauri::AppHandle) -> Option<UsageReport>`
  - `pub fn seed(app: &tauri::AppHandle)`
  - `pub fn flush(app: &tauri::AppHandle)`

- [ ] **Step 1: `UsageReport`에 `Deserialize` 추가 (디스크에서 역직렬화 필요)**

`src-tauri/src/usage.rs` line 3을 수정:

```rust
use serde::{Deserialize, Serialize};
```

`src-tauri/src/usage.rs`의 `UsageReport` derive(line 8) 수정:

```rust
#[derive(Serialize, Deserialize, Clone)]
pub struct UsageReport {
    pub claude: UsageSnapshot,
    pub codex: UsageSnapshot,
}
```

- [ ] **Step 2: 모듈 선언 추가**

`src-tauri/src/lib.rs`의 `mod usage;`(line 5) 바로 아래에 추가:

```rust
mod usage;
mod usage_cache;
```

- [ ] **Step 3: 실패하는 테스트부터 작성 — `usage_cache.rs` 생성 (모듈 본문 + 테스트)**

`src-tauri/src/usage_cache.rs` 전체:

```rust
//! Cross-restart cache of the last *good* usage snapshot per provider.
//!
//! Claude usage is a remote-only resource, so a cold start can't paint it until
//! a network round-trip finishes. We keep the last error-free snapshot in memory
//! (`LastGood`), seed it from disk at startup, and flush it back on exit, so the
//! next launch can show it instantly (labeled as cached) while the live fetch
//! runs. This is a tray app — the process is long-lived — so once-at-exit is the
//! right write cadence.

use crate::model::{Source, UsageSnapshot};
use crate::usage::UsageReport;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "usage-cache.json";
const KEY: &str = "report";

/// In-memory holder for the last error-free report, one snapshot per provider.
/// Seeded from disk at startup, updated by the poller, flushed to disk at exit.
#[derive(Default)]
pub struct LastGood(pub Mutex<Option<UsageReport>>);

impl LastGood {
    /// Fold a freshly-collected report in, keeping the previous snapshot for any
    /// provider whose fresh snapshot carries an error (so a Claude blip doesn't
    /// wipe Codex's good data, and vice versa).
    pub fn update(&self, fresh: &UsageReport) {
        let mut g = self.0.lock().unwrap();
        *g = Some(merge_persisted(g.as_ref(), fresh));
    }

    /// The held report with every snapshot marked `Source::Cache`, or `None` if
    /// nothing good has been seen yet.
    pub fn as_cache(&self) -> Option<UsageReport> {
        self.0.lock().unwrap().as_ref().map(as_cache)
    }
}

/// Per provider: take `fresh` when it has data (no error), else fall back to the
/// matching provider in `prev`. With no `prev` and an errored `fresh`, there is
/// nothing better to return, so `fresh` is used as-is.
pub fn merge_persisted(prev: Option<&UsageReport>, fresh: &UsageReport) -> UsageReport {
    UsageReport {
        claude: pick(prev.map(|p| &p.claude), &fresh.claude),
        codex: pick(prev.map(|p| &p.codex), &fresh.codex),
    }
}

fn pick(prev: Option<&UsageSnapshot>, fresh: &UsageSnapshot) -> UsageSnapshot {
    if fresh.error.is_none() {
        fresh.clone()
    } else {
        prev.cloned().unwrap_or_else(|| fresh.clone())
    }
}

fn as_cache(r: &UsageReport) -> UsageReport {
    let mut out = r.clone();
    out.claude.source = Source::Cache;
    out.codex.source = Source::Cache;
    out
}

/// Read the persisted report from disk (best-effort; `None` on any failure).
pub fn read_disk(app: &AppHandle) -> Option<UsageReport> {
    let store = app.store(STORE_FILE).ok()?;
    let value = store.get(KEY)?;
    serde_json::from_value(value).ok()
}

/// Load the disk cache into the in-memory holder. Called once at startup.
pub fn seed(app: &AppHandle) {
    let Some(report) = read_disk(app) else { return };
    if let Some(state) = app.try_state::<LastGood>() {
        *state.0.lock().unwrap() = Some(report);
    }
}

/// Write the in-memory holder back to disk (best-effort). Called once at exit.
pub fn flush(app: &AppHandle) {
    let Some(state) = app.try_state::<LastGood>() else { return };
    let held = state.0.lock().unwrap().clone();
    let Some(report) = held else { return };
    if let Ok(store) = app.store(STORE_FILE) {
        if let Ok(value) = serde_json::to_value(&report) {
            store.set(KEY, value);
            let _ = store.save();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::ProviderId;

    fn snap(provider: ProviderId, updated_at: i64, error: Option<&str>) -> UsageSnapshot {
        UsageSnapshot {
            provider,
            plan: "Max".into(),
            plan_raw: "max".into(),
            source: Source::Live,
            updated_at,
            windows: vec![],
            error: error.map(|s| s.to_string()),
        }
    }
    fn report(claude: UsageSnapshot, codex: UsageSnapshot) -> UsageReport {
        UsageReport { claude, codex }
    }

    #[test]
    fn merge_takes_fresh_when_both_good() {
        let prev = report(snap(ProviderId::Claude, 1, None), snap(ProviderId::Codex, 1, None));
        let fresh = report(snap(ProviderId::Claude, 2, None), snap(ProviderId::Codex, 2, None));
        let m = merge_persisted(Some(&prev), &fresh);
        assert_eq!(m.claude.updated_at, 2);
        assert_eq!(m.codex.updated_at, 2);
    }

    #[test]
    fn merge_keeps_prev_for_errored_provider_only() {
        // Claude fails this round, Codex succeeds → keep prev Claude, take fresh Codex.
        let prev = report(snap(ProviderId::Claude, 1, None), snap(ProviderId::Codex, 1, None));
        let fresh = report(
            snap(ProviderId::Claude, 2, Some("request failed")),
            snap(ProviderId::Codex, 2, None),
        );
        let m = merge_persisted(Some(&prev), &fresh);
        assert_eq!(m.claude.updated_at, 1); // preserved
        assert!(m.claude.error.is_none());
        assert_eq!(m.codex.updated_at, 2); // updated
    }

    #[test]
    fn merge_uses_fresh_when_no_prev_even_if_errored() {
        let fresh = report(
            snap(ProviderId::Claude, 2, Some("credentials not found")),
            snap(ProviderId::Codex, 2, None),
        );
        let m = merge_persisted(None, &fresh);
        assert_eq!(m.claude.error.as_deref(), Some("credentials not found"));
    }

    #[test]
    fn as_cache_marks_both_snapshots_cache() {
        let r = report(snap(ProviderId::Claude, 1, None), snap(ProviderId::Codex, 1, None));
        let c = as_cache(&r);
        assert_eq!(c.claude.source, Source::Cache);
        assert_eq!(c.codex.source, Source::Cache);
    }
}
```

- [ ] **Step 4: 테스트 실행 (통과 확인)**

Run: `cd src-tauri && cargo test --lib usage_cache::`
Expected: 4 tests pass (`merge_takes_fresh_when_both_good`, `merge_keeps_prev_for_errored_provider_only`, `merge_uses_fresh_when_no_prev_even_if_errored`, `as_cache_marks_both_snapshots_cache`).

- [ ] **Step 5: 커밋**

```bash
git add src-tauri/src/usage_cache.rs src-tauri/src/usage.rs src-tauri/src/lib.rs
git commit -m "feat(usage-cache): last-good snapshot holder + per-provider merge"
```

---

### Task 2: 백엔드 — 배선 (manage·seed·poller 갱신·종료 flush·`get_cached_usage`)

**Files:**
- Modify: `src-tauri/src/lib.rs` (manage, setup seed, invoke_handler, `.build().run()` exit 훅)
- Modify: `src-tauri/src/poller.rs:3` (Manager import), 수집 직후 `update` 호출
- Modify: `src-tauri/src/commands.rs` (`get_cached_usage` 커맨드)

**Interfaces:**
- Consumes: Task 1의 `usage_cache::{LastGood, seed, flush}`, `LastGood::{update, as_cache}`.
- Produces: `#[tauri::command] pub fn get_cached_usage(cache: tauri::State<'_, LastGood>) -> Option<UsageReport>`; invoke 이름 `"get_cached_usage"`.

- [ ] **Step 1: `get_cached_usage` 커맨드 추가**

`src-tauri/src/commands.rs`의 import 블록에 추가(파일 상단, 기존 `use crate::usage::{self, UsageReport};` 아래):

```rust
use crate::usage_cache::LastGood;
```

`get_usage` 커맨드(line 11-14) 바로 아래에 추가:

```rust
/// The last successful snapshot held in memory (seeded from disk at startup),
/// marked as cached. Lets the UI paint instantly on launch before the live
/// fetch lands. Returns `None` when nothing good has been cached yet.
#[tauri::command]
pub fn get_cached_usage(cache: tauri::State<'_, LastGood>) -> Option<UsageReport> {
    cache.as_cache()
}
```

- [ ] **Step 2: 폴러가 매 수집마다 `LastGood` 갱신**

`src-tauri/src/poller.rs` line 7의 import에 `Manager` 추가:

```rust
use tauri::{AppHandle, Emitter, Manager};
```

`src-tauri/src/poller.rs`의 수집 라인(`let collected = usage::collect_detailed().await;`) 바로 아래에 갱신 호출 추가:

```rust
            let collected = usage::collect_detailed().await;
            // Keep the cross-restart cache fresh; flushed to disk on exit.
            app.state::<crate::usage_cache::LastGood>().update(&collected.report);
            let report = &collected.report;
```

- [ ] **Step 3: `LastGood` 등록 · 시작 시 시딩 · 커맨드 등록 · 종료 flush**

`src-tauri/src/lib.rs`에서 `.manage(commands::UsageCache::default())` 아래에 추가:

```rust
        .manage(commands::UsageCache::default())
        .manage(usage_cache::LastGood::default())
```

`invoke_handler`의 `commands::get_usage,` 아래에 추가:

```rust
            commands::get_usage,
            commands::get_cached_usage,
```

`setup` 안에서 `poller::start(app.handle().clone());` 바로 아래에 시딩 추가:

```rust
            poller::start(app.handle().clone());
            // Load the last-good snapshot from disk so get_cached_usage can serve
            // it the instant the frontend mounts.
            usage_cache::seed(app.handle());
```

파일 끝의 실행부(`.run(tauri::generate_context!())` + `.expect(...)`)를 build+run 형태로 교체해 종료 훅 추가:

```rust
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|handle, event| {
            // Flush the last-good usage snapshot to disk once, as the app exits,
            // so the next launch can paint it instantly. Full exit is deliberate
            // (tray "종료") on this tray app; a force-kill skips this and simply
            // leaves the previous clean-exit cache in place.
            if let tauri::RunEvent::Exit = event {
                usage_cache::flush(handle);
            }
        });
```

- [ ] **Step 4: 빌드 · 기존 테스트 · 린트 확인**

Run: `cd src-tauri && cargo test --lib 2>&1 | tail -5`
Expected: 모든 테스트 통과(기존 + Task 1의 usage_cache 4개), 컴파일 성공.

Run: `cd src-tauri && cargo clippy --lib 2>&1 | grep -c "warning: .*usage_cache\|warning: .*poller\|warning: .*commands\|warning: .*lib.rs"`
Expected: `0` (내가 만진 파일에서 새 경고 없음; 기존 codex.rs 경고는 무관).

- [ ] **Step 5: 커밋**

```bash
git add src-tauri/src/lib.rs src-tauri/src/poller.rs src-tauri/src/commands.rs
git commit -m "feat(usage-cache): seed on start, update on poll, flush on exit; add get_cached_usage"
```

---

### Task 3: 프론트 — `formatRelativeAge` 헬퍼

**Files:**
- Modify: `src/lib/format.ts` (함수 추가)
- Test: `src/lib/format.test.ts` (import 병합 + describe 추가)

**Interfaces:**
- Produces: `export function formatRelativeAge(epochSeconds: number, nowSeconds: number, locale: "en" | "ko"): string`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/format.test.ts` line 2의 import에 `formatRelativeAge` 추가:

```ts
import { formatCountdown, formatTokens, formatUsd, formatRelativeAge } from "./format";
```

파일 맨 끝에 describe 블록 추가:

```ts
describe("formatRelativeAge", () => {
  const now = 1_000_000;
  it("says just now under a minute", () => {
    expect(formatRelativeAge(now - 30, now, "en")).toBe("just now");
    expect(formatRelativeAge(now - 30, now, "ko")).toBe("방금");
  });
  it("counts minutes, hours, and days", () => {
    expect(formatRelativeAge(now - 300, now, "en")).toBe("5m ago");
    expect(formatRelativeAge(now - 7200, now, "en")).toBe("2h ago");
    expect(formatRelativeAge(now - 172_800, now, "ko")).toBe("2일 전");
  });
  it("never goes negative for a future timestamp", () => {
    expect(formatRelativeAge(now + 500, now, "en")).toBe("just now");
  });
});
```

- [ ] **Step 2: 테스트 실행 (실패 확인)**

Run: `npx vitest run src/lib/format.test.ts`
Expected: FAIL — `formatRelativeAge is not a function` (아직 미구현).

- [ ] **Step 3: 구현**

`src/lib/format.ts` 파일 끝에 추가:

```ts
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
```

- [ ] **Step 4: 테스트 실행 (통과 확인)**

Run: `npx vitest run src/lib/format.test.ts`
Expected: PASS (formatRelativeAge 3개 포함 전부).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/format.ts src/lib/format.test.ts
git commit -m "feat(format): formatRelativeAge for cached snapshot age"
```

---

### Task 4: 프론트 — `fetchCachedUsage` + 캐시 우선 페인트 (메인 창 + 위젯)

**Files:**
- Modify: `src/lib/usage.ts` (`fetchCachedUsage` 추가)
- Modify: `src/App.tsx:3` (import), `src/App.tsx:62-71` (초기 로드 effect)
- Modify: `src/lib/useUsageReport.ts:2` (import), mount effect
- Test: `src/App.test.tsx`, `src/lib/useUsageReport.test.tsx`

**Interfaces:**
- Consumes: `get_cached_usage`(Task 2), `mergeReport`/`onUsageUpdated`(기존).
- Produces: `export function fetchCachedUsage(): Promise<UsageReport | null>`.

- [ ] **Step 1: `fetchCachedUsage` 추가**

`src/lib/usage.ts`의 `fetchUsage`(line 5-7) 바로 아래에 추가:

```ts
export function fetchCachedUsage(): Promise<UsageReport | null> {
  return invoke<UsageReport | null>("get_cached_usage");
}
```

- [ ] **Step 2: 실패하는 테스트 작성 — 위젯 훅**

`src/lib/useUsageReport.test.tsx`의 `describe` 안에 테스트 추가:

```ts
  it("paints the cached report before the live one arrives", async () => {
    const cached: UsageReport = {
      claude: { ...report.claude, source: "cache", updated_at: 5 },
      codex: { ...report.codex, source: "cache", updated_at: 5 },
    };
    let releaseLive!: (r: UsageReport) => void;
    vi.mocked(invoke).mockImplementation(((cmd: string) => {
      if (cmd === "get_cached_usage") return Promise.resolve(cached);
      if (cmd === "get_usage") return new Promise((res) => { releaseLive = res as (r: UsageReport) => void; });
      return Promise.resolve(null);
    }) as never);

    const { result } = renderHook(() => useUsageReport());
    await waitFor(() => expect(result.current.report?.claude.source).toBe("cache"));
    releaseLive(report);
    await waitFor(() => expect(result.current.report?.claude.source).toBe("live"));
  });
```

- [ ] **Step 3: 실패하는 테스트 작성 — 메인 App**

`src/App.test.tsx`의 첫 번째 `describe("App", ...)` 안에 테스트 추가:

```ts
  it("paints the disk-cached snapshot instantly, then replaces it with the live one", async () => {
    const cached: UsageReport = {
      claude: { ...report.claude, source: "cache", updated_at: 5 },
      codex: { ...report.codex, source: "cache", updated_at: 5 },
    };
    let releaseLive!: (r: UsageReport) => void;
    vi.mocked(invoke).mockImplementation(((cmd: string) => {
      if (cmd === "get_cached_usage") return Promise.resolve(cached);
      if (cmd === "get_usage") return new Promise((res) => { releaseLive = res as (r: UsageReport) => void; });
      return defaultInvoke(cmd);
    }) as never);

    render(<App />);
    // Cached cards appear before the (still pending) live fetch — no skeleton wait.
    await screen.findByText("Max 20x");
    expect(screen.queryByTestId("provider-skeleton")).toBeNull();
    // The cached badge shows while live is in flight.
    expect(screen.getAllByText(/cached/i).length).toBeGreaterThan(0);

    releaseLive(report);
    // Once live lands, the cached badge is gone (source: live).
    await waitFor(() => expect(screen.queryByText(/cached/i)).toBeNull());
  });
```

- [ ] **Step 4: 테스트 실행 (실패 확인)**

Run: `npx vitest run src/App.test.tsx src/lib/useUsageReport.test.tsx -t "cached"`
Expected: FAIL — 아직 캐시 페인트 미구현이라 캐시 카드/`source: "cache"`가 안 나타남.

- [ ] **Step 5: 위젯 훅 구현**

`src/lib/useUsageReport.ts` line 2 import 수정:

```ts
import { fetchUsage, fetchCachedUsage, onUsageUpdated, mergeReport } from "./usage";
```

mount effect(현재 `reload(); const un = onUsageUpdated(apply); ...`)를 수정:

```ts
  useEffect(() => {
    // 디스크 캐시를 먼저 즉시 그린다(있을 때, 그리고 아직 아무것도 없을 때만).
    fetchCachedUsage().then((c) => { if (c) setReport((prev) => prev ?? c); });
    reload();
    const un = onUsageUpdated(apply);
    return () => { un.then((f) => f()); };
  }, [apply, reload]);
```

- [ ] **Step 6: 메인 App 구현**

`src/App.tsx` line 3 import 수정:

```ts
import { fetchUsage, fetchCachedUsage, onUsageUpdated, mergeReport } from "./lib/usage";
```

초기 로드 effect(현재 line 62-71)를 수정:

```tsx
  // 초기 로드: 디스크 캐시를 먼저 즉시 그린 뒤, 라이브 갱신으로 교체.
  useEffect(() => {
    getSettings().then((s) => {
      setSettingsState(s);
      applyTheme(s.theme);
      i18n.changeLanguage(s.language);
    });
    // 더 빠른 라이브 결과를 오래된 캐시로 덮지 않도록 '아직 없을 때만' 채운다.
    fetchCachedUsage().then((c) => { if (c) setReport((prev) => prev ?? c); });
    setLimitsRefreshing(true);
    load().finally(() => setLimitsRefreshing(false));
    const un = onUsageUpdated(applyReport);
    return () => { un.then((f) => f()); };
  }, [i18n, applyReport, load]);
```

- [ ] **Step 7: 테스트 실행 (통과 확인)**

Run: `npx vitest run src/App.test.tsx src/lib/useUsageReport.test.tsx`
Expected: PASS (신규 캐시 테스트 + 기존 테스트 전부). 기존 테스트의 `defaultInvoke`/기본 mock은 `get_cached_usage`에 `null`을 반환하므로 캐시 페인트는 no-op → 영향 없음.

- [ ] **Step 8: 커밋**

```bash
git add src/lib/usage.ts src/App.tsx src/lib/useUsageReport.ts src/App.test.tsx src/lib/useUsageReport.test.tsx
git commit -m "feat(usage): paint disk-cached snapshot on mount, replace with live"
```

---

### Task 5: 프론트 — 캐시 뱃지에 캐시 시각 표시

**Files:**
- Modify: `src/components/ProviderCard.tsx` (import + 뱃지)
- Test: `src/components/ProviderCard.test.tsx` (기존 "shows cached badge" 갱신)

**Interfaces:**
- Consumes: `formatRelativeAge`(Task 3). ProviderCard는 이미 `now: number`, `locale: "en" | "ko"` prop 보유.

- [ ] **Step 1: 실패하는 테스트로 갱신**

`src/components/ProviderCard.test.tsx`의 기존 테스트(`it("shows cached badge", ...)`)를 아래로 교체:

```tsx
  it("shows the cached badge with the snapshot's age", () => {
    // updated_at 0, now 300s → "5m ago" 가 캐시 라벨과 함께.
    render(wrap(<ProviderCard snapshot={{ ...base, source: "cache", updated_at: 0 }} now={300} locale="en" />));
    expect(screen.getByText(/cached · 5m ago/)).toBeInTheDocument();
  });
```

- [ ] **Step 2: 테스트 실행 (실패 확인)**

Run: `npx vitest run src/components/ProviderCard.test.tsx -t "cached badge"`
Expected: FAIL — 현재 뱃지는 `cached`만 렌더(나이 없음).

- [ ] **Step 3: 구현**

`src/components/ProviderCard.tsx` import 블록에 추가:

```tsx
import { formatRelativeAge } from "../lib/format";
```

캐시 뱃지(현재 `<span className="provider-card__cached">{t("app.cached")}</span>`) 를 수정:

```tsx
        {snapshot.source === "cache" && !snapshot.error && (
          <span className="provider-card__cached">
            {t("app.cached")} · {formatRelativeAge(snapshot.updated_at, now, locale)}
          </span>
        )}
```

- [ ] **Step 4: 테스트 실행 (통과 확인)**

Run: `npx vitest run src/components/ProviderCard.test.tsx`
Expected: PASS (갱신된 캐시 뱃지 테스트 + 기존 ProviderCard 테스트 전부).

- [ ] **Step 5: 전체 스위트 · 타입체크 최종 확인**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 전체 프론트 테스트 통과, 타입 에러 없음.

- [ ] **Step 6: 커밋**

```bash
git add src/components/ProviderCard.tsx src/components/ProviderCard.test.tsx
git commit -m "feat(provider-card): show cached snapshot age in the badge"
```

---

## 검증 요약 (실행자용)

- 백엔드: `cd src-tauri && cargo test --lib` (전체) + `cargo clippy --lib` (새 경고 없음).
- 프론트: `npx vitest run` (전체) + `npx tsc --noEmit`.
- 육안(선택): dev 서버 + tauri 스텁으로 캐시→라이브 전환과 `캐시됨 · N분 전` 뱃지 확인(스크린샷 인프라 `scripts/screenshots/` 재사용).

## 알려진 트레이드오프 (스펙과 동일)

강제 종료·크래시·하드 셧다운 시 `RunEvent::Exit`가 실행되지 않아 디스크 캐시는 직전 정상 종료 시점으로 남는다(라벨 붙고 실행 즉시 라이브 갱신). 최초 실행엔 캐시가 없어 기존 스켈레톤/스피너.

## 스펙 대비 의도적 단순화

스펙의 "`get_usage` 커맨드에서도 `update` 호출"은 생략한다 — 폴러가 매 주기(첫 틱은 시작 직후 즉시) `LastGood`를 갱신하므로 종료-flush 신선도에 충분하고, `get_usage`의 시그니처/반환 계약을 건드리지 않아 더 안전하다.
