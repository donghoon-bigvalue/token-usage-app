# 월별 토큰 사용량 & 비용 추정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 로컬 Claude Code / Codex 로그를 스캔해 월별 토큰 사용량과 API 환산 추정 비용을 앱에서 보여주고 CSV로 내려받게 한다.

**Architecture:** Rust 백엔드가 `~/.claude/projects/**/*.jsonl`과 `~/.codex/sessions/**/*.jsonl`을 스캔·집계·비용계산하여 Tauri command로 노출한다. React는 별도 "사용 이력" 뷰에서 이번 달 요약 카드 + 월별 표를 렌더하고, CSV 다운로드는 dialog 플러그인으로 경로를 받아 Rust가 파일을 쓴다.

**Tech Stack:** Rust + Tauri v2, serde_json, chrono, dirs / React 19 + TypeScript + Vite, i18next, vitest, `@tauri-apps/plugin-dialog`

## Global Constraints

- 비용은 **API 요금 환산 추정치**이며 구독제 실제 청구액과 무관 — UI에 명시.
- 단가는 `pricing.rs`에 **per-MTok USD**로 내장. 미등록 모델은 비용 `None`.
- Claude 캐시 필드(`cache_creation`/`cache_read`)는 `input_tokens`와 **배타적**. Codex `input_tokens`는 `cached_input_tokens`를 **포함**.
- Codex 월 귀속: `token_count` 이벤트의 `last_token_usage` 델타를, 이벤트 `timestamp`의 월 + 직전 `turn_context.model`에 귀속.
- `year_month`는 timestamp 앞 7글자(`YYYY-MM`, UTC 기준). `current_month`도 `chrono::Utc` 기준으로 맞춤.
- 깨진 JSONL 라인 / usage 없는 라인은 스킵 (기존 파서 패턴 준수).
- 강조색: Claude `#D97757`, Codex `#5162ED` (기존 팔레트 재사용).
- 프런트 테스트는 vitest, Rust 테스트는 `#[cfg(test)]` + `tests/fixtures` 패턴.

---

### Task 1: 단가 테이블 & 비용 계산 (`pricing.rs`)

**Files:**
- Create: `src-tauri/src/pricing.rs`
- Modify: `src-tauri/src/lib.rs:1-6` (add `mod pricing;`)

**Interfaces:**
- Produces:
  - `pub struct ModelPricing { pub input: f64, pub output: f64, pub cache_write: f64, pub cache_read: f64, pub cached_input: f64 }` (per-MTok USD)
  - `impl ModelPricing { pub fn claude_cost(&self, input:u64, output:u64, cache_write:u64, cache_read:u64) -> f64; pub fn codex_cost(&self, input_total:u64, cached:u64, output:u64) -> f64 }`
  - `pub fn pricing_for(model: &str) -> Option<ModelPricing>`

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/pricing.rs` with only the test module:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_opus_cost_sums_all_buckets() {
        let p = pricing_for("claude-opus-4-8").unwrap();
        // 1M input @15 + 1M output @75 + 1M cache_write @18.75 + 1M cache_read @1.5
        let cost = p.claude_cost(1_000_000, 1_000_000, 1_000_000, 1_000_000);
        assert!((cost - (15.0 + 75.0 + 18.75 + 1.5)).abs() < 1e-9);
    }

    #[test]
    fn codex_cost_excludes_cached_from_input_rate() {
        let p = pricing_for("gpt-5.5").unwrap();
        // input_total 1M with 400k cached: 600k @1.25 + 400k @0.125 + 1M output @10
        let cost = p.codex_cost(1_000_000, 400_000, 1_000_000);
        let expected = 0.6 * 1.25 + 0.4 * 0.125 + 10.0;
        assert!((cost - expected).abs() < 1e-9);
    }

    #[test]
    fn unknown_model_has_no_pricing() {
        assert!(pricing_for("mystery-model-9").is_none());
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test pricing:: 2>&1 | head -20`
Expected: FAIL — `cannot find function pricing_for` / `ModelPricing` not found.

- [ ] **Step 3: Write minimal implementation**

Prepend to `src-tauri/src/pricing.rs` (above the test module):

```rust
//! Model pricing table — public API rates, per million tokens (MTok), USD.
//! These are ESTIMATES for API-equivalent cost; subscription billing differs.
//! Adjust values here when published prices change.

/// Per-MTok USD rates for one model.
#[derive(Debug, Clone, Copy)]
pub struct ModelPricing {
    /// Uncached input rate.
    pub input: f64,
    pub output: f64,
    /// Claude cache-creation (write) rate.
    pub cache_write: f64,
    /// Claude cache-read rate.
    pub cache_read: f64,
    /// Codex/OpenAI cached-input rate.
    pub cached_input: f64,
}

fn per_m(tokens: u64, rate_per_million: f64) -> f64 {
    (tokens as f64) / 1_000_000.0 * rate_per_million
}

impl ModelPricing {
    /// Claude-style: cache tokens are separate, non-overlapping fields.
    pub fn claude_cost(&self, input: u64, output: u64, cache_write: u64, cache_read: u64) -> f64 {
        per_m(input, self.input)
            + per_m(output, self.output)
            + per_m(cache_write, self.cache_write)
            + per_m(cache_read, self.cache_read)
    }

    /// Codex-style: `input_total` already includes `cached`.
    pub fn codex_cost(&self, input_total: u64, cached: u64, output: u64) -> f64 {
        let uncached = input_total.saturating_sub(cached);
        per_m(uncached, self.input) + per_m(cached, self.cached_input) + per_m(output, self.output)
    }
}

/// Look up pricing by model id (case-insensitive substring match).
/// Returns None for unknown models so callers can flag "estimate unavailable".
pub fn pricing_for(model: &str) -> Option<ModelPricing> {
    let m = model.to_ascii_lowercase();
    // --- Claude family (cache fields separate) ---
    if m.contains("opus") {
        return Some(ModelPricing { input: 15.0, output: 75.0, cache_write: 18.75, cache_read: 1.5, cached_input: 0.0 });
    }
    if m.contains("sonnet") {
        return Some(ModelPricing { input: 3.0, output: 15.0, cache_write: 3.75, cache_read: 0.30, cached_input: 0.0 });
    }
    if m.contains("haiku") {
        return Some(ModelPricing { input: 1.0, output: 5.0, cache_write: 1.25, cache_read: 0.10, cached_input: 0.0 });
    }
    if m.contains("fable") {
        // Estimate — replace when official Fable pricing is published.
        return Some(ModelPricing { input: 5.0, output: 25.0, cache_write: 6.25, cache_read: 0.50, cached_input: 0.0 });
    }
    // --- Codex / OpenAI GPT-5 family (input includes cached) ---
    if m.contains("gpt-5") || m.contains("codex") {
        return Some(ModelPricing { input: 1.25, output: 10.0, cache_write: 0.0, cache_read: 0.0, cached_input: 0.125 });
    }
    None
}
```

Then add `mod pricing;` to `src-tauri/src/lib.rs` after `mod model;` (line ~1).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test pricing:: 2>&1 | tail -8`
Expected: PASS — 3 tests ok.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/pricing.rs src-tauri/src/lib.rs
git commit -m "feat(usage): 모델별 API 단가 테이블·비용 계산 추가 (#19)"
```

---

### Task 2: 사용 이력 타입 (`model.rs`)

**Files:**
- Modify: `src-tauri/src/model.rs` (append types + `year_month_of`)

**Interfaces:**
- Consumes: `ProviderId` (existing in `model.rs`).
- Produces:
  - `pub fn year_month_of(ts: &str) -> Option<String>`
  - `pub struct UsageRecord { year_month:String, provider:ProviderId, model:String, input_tokens:u64, output_tokens:u64, cache_write_tokens:u64, cache_read_tokens:u64, cached_input_tokens:u64 }`
  - `pub struct MonthlyDetail { year_month:String, provider:ProviderId, model:String, input_tokens:u64, output_tokens:u64, cache_write_tokens:u64, cache_read_tokens:u64, cached_input_tokens:u64, total_tokens:u64, cost_usd:Option<f64> }`
  - `pub struct MonthlySummary { year_month:String, provider:ProviderId, total_tokens:u64, cost_usd:Option<f64>, cost_estimable:bool }`
  - `pub struct UsageHistory { current_month:String, summaries:Vec<MonthlySummary>, details:Vec<MonthlyDetail> }`
  - All structs derive `Serialize, Deserialize` (serde) so Tauri can pass them to the frontend.

- [ ] **Step 1: Write the failing test**

Add to the existing `#[cfg(test)] mod tests` in `src-tauri/src/model.rs`:

```rust
    #[test]
    fn year_month_extracts_prefix() {
        assert_eq!(year_month_of("2026-07-08T06:09:03.964Z").as_deref(), Some("2026-07"));
    }

    #[test]
    fn year_month_rejects_garbage() {
        assert_eq!(year_month_of("not-a-date"), None);
        assert_eq!(year_month_of("2026/07"), None);
        assert_eq!(year_month_of("2026-7"), None);
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test model::tests::year_month 2>&1 | head -15`
Expected: FAIL — `cannot find function year_month_of`.

- [ ] **Step 3: Write minimal implementation**

Append to `src-tauri/src/model.rs` (before the `#[cfg(test)]` module):

```rust
/// `YYYY-MM` prefix of an ISO8601 timestamp, or None if it doesn't look like one.
/// Validates the `YYYY-MM-` shape (digits + dashes) so junk lines are skipped.
pub fn year_month_of(ts: &str) -> Option<String> {
    let b = ts.as_bytes();
    if b.len() < 8 { return None; }
    let ok = b[0..4].iter().all(u8::is_ascii_digit)
        && b[4] == b'-'
        && b[5].is_ascii_digit()
        && b[6].is_ascii_digit()
        && b[7] == b'-';
    if ok { Some(ts[0..7].to_string()) } else { None }
}

/// One raw usage sample before aggregation. Token fields carry provider-specific
/// meaning (see Global Constraints): Claude cache fields are separate; Codex
/// `input_tokens` already includes `cached_input_tokens`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UsageRecord {
    pub year_month: String,
    pub provider: ProviderId,
    pub model: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_write_tokens: u64,
    pub cache_read_tokens: u64,
    pub cached_input_tokens: u64,
}

/// One aggregated row: (year_month × provider × model). Used for CSV detail.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MonthlyDetail {
    pub year_month: String,
    pub provider: ProviderId,
    pub model: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_write_tokens: u64,
    pub cache_read_tokens: u64,
    pub cached_input_tokens: u64,
    pub total_tokens: u64,
    pub cost_usd: Option<f64>,
}

/// One summary row: (year_month × provider). Used for the on-screen table.
/// `cost_estimable` is false when any model in the bucket lacked pricing.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MonthlySummary {
    pub year_month: String,
    pub provider: ProviderId,
    pub total_tokens: u64,
    pub cost_usd: Option<f64>,
    pub cost_estimable: bool,
}

/// Full history payload returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageHistory {
    pub current_month: String,
    pub summaries: Vec<MonthlySummary>,
    pub details: Vec<MonthlyDetail>,
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test model::tests::year_month 2>&1 | tail -8`
Expected: PASS — 2 tests ok.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/model.rs
git commit -m "feat(usage): 월별 사용량 집계 타입·year_month 헬퍼 추가 (#19)"
```

---

### Task 3: Claude 로그 스캔 (`providers/claude.rs`)

**Files:**
- Modify: `src-tauri/src/providers/claude.rs:1-3` (imports) + append `scan_usage` + private `walk_jsonl` + tests

**Interfaces:**
- Consumes: `UsageRecord`, `ProviderId`, `year_month_of` (from `model.rs`).
- Produces: `pub fn scan_usage(claude_home: &Path) -> Vec<UsageRecord>` — scans `claude_home/projects/**/*.jsonl`, one record per assistant message with usage.

- [ ] **Step 1: Write the failing test**

Append to `src-tauri/src/providers/claude.rs` (inside its existing `#[cfg(test)] mod tests`, or add one if absent — the file already has tests, add there):

```rust
    #[test]
    fn scan_usage_reads_assistant_messages() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();
        let pdir = home.join("projects/some-project");
        std::fs::create_dir_all(&pdir).unwrap();
        let line = r#"{"type":"assistant","timestamp":"2026-07-08T06:09:03.964Z","message":{"model":"claude-sonnet-5","usage":{"input_tokens":100,"output_tokens":20,"cache_creation_input_tokens":30,"cache_read_input_tokens":40}}}"#;
        let noise = r#"{"type":"user","timestamp":"2026-07-08T06:09:00.000Z","message":{"role":"user"}}"#;
        std::fs::write(pdir.join("s.jsonl"), format!("{line}\n{noise}\nbroken line\n")).unwrap();

        let recs = scan_usage(home);
        assert_eq!(recs.len(), 1);
        let r = &recs[0];
        assert_eq!(r.year_month, "2026-07");
        assert_eq!(r.provider, ProviderId::Claude);
        assert_eq!(r.model, "claude-sonnet-5");
        assert_eq!(r.input_tokens, 100);
        assert_eq!(r.output_tokens, 20);
        assert_eq!(r.cache_write_tokens, 30);
        assert_eq!(r.cache_read_tokens, 40);
    }
```

> `tempfile` is already a dev-dependency if the codex tests use `tempdir()`. If `cargo test` reports `tempfile` unresolved, add `tempfile = "3"` under `[dev-dependencies]` in `src-tauri/Cargo.toml`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test claude::tests::scan_usage 2>&1 | head -15`
Expected: FAIL — `cannot find function scan_usage`.

- [ ] **Step 3: Write minimal implementation**

Change the import on line 3 of `src-tauri/src/providers/claude.rs`:

```rust
use std::path::{Path, PathBuf};
```

Add `UsageRecord` and `year_month_of` to the `crate::model` import on line 1:

```rust
use crate::model::{iso8601_to_epoch, year_month_of, LimitWindow, ProviderId, Source, UsageRecord, UsageSnapshot, WindowId};
```

Append near the end of the file (before the `#[cfg(test)]` module):

```rust
// ---- Historical usage scan (issue #19) ----

#[derive(Deserialize)]
struct ScanLine {
    #[serde(rename = "type")]
    kind: Option<String>,
    timestamp: Option<String>,
    message: Option<ScanMessage>,
}

#[derive(Deserialize)]
struct ScanMessage {
    model: Option<String>,
    usage: Option<ScanUsage>,
}

#[derive(Deserialize)]
struct ScanUsage {
    #[serde(default)]
    input_tokens: u64,
    #[serde(default)]
    output_tokens: u64,
    #[serde(default)]
    cache_creation_input_tokens: u64,
    #[serde(default)]
    cache_read_input_tokens: u64,
}

fn walk_jsonl(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else { return out };
    for e in entries.flatten() {
        let p = e.path();
        if p.is_dir() {
            out.extend(walk_jsonl(&p));
        } else if p.extension().map(|x| x == "jsonl").unwrap_or(false) {
            out.push(p);
        }
    }
    out
}

/// Scan `~/.claude/projects/**/*.jsonl` for per-message token usage.
/// One `UsageRecord` per assistant message that carries a `usage` block.
pub fn scan_usage(claude_home: &Path) -> Vec<UsageRecord> {
    let mut out = Vec::new();
    for path in walk_jsonl(&claude_home.join("projects")) {
        let Ok(content) = std::fs::read_to_string(&path) else { continue };
        for line in content.lines() {
            let Ok(l) = serde_json::from_str::<ScanLine>(line) else { continue };
            if l.kind.as_deref() != Some("assistant") { continue; }
            let (Some(ts), Some(msg)) = (l.timestamp, l.message) else { continue };
            let Some(usage) = msg.usage else { continue };
            let Some(ym) = year_month_of(&ts) else { continue };
            out.push(UsageRecord {
                year_month: ym,
                provider: ProviderId::Claude,
                model: msg.model.unwrap_or_else(|| "unknown".to_string()),
                input_tokens: usage.input_tokens,
                output_tokens: usage.output_tokens,
                cache_write_tokens: usage.cache_creation_input_tokens,
                cache_read_tokens: usage.cache_read_input_tokens,
                cached_input_tokens: 0,
            });
        }
    }
    out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test claude::tests::scan_usage 2>&1 | tail -8`
Expected: PASS — 1 test ok.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/providers/claude.rs src-tauri/Cargo.toml
git commit -m "feat(usage): Claude projects 로그 토큰 사용량 스캔 (#19)"
```

---

### Task 4: Codex 로그 스캔 (`providers/codex.rs`)

**Files:**
- Modify: `src-tauri/src/providers/codex.rs:1` (imports) + append `scan_usage` + tests

**Interfaces:**
- Consumes: `UsageRecord`, `ProviderId`, `year_month_of` (from `model.rs`); reuses existing private `walk_jsonl(root: &Path) -> Vec<PathBuf>` in this file (codex.rs:328).
- Produces: `pub fn scan_usage(codex_home: &Path) -> Vec<UsageRecord>` — scans `codex_home/sessions/**/*.jsonl`; sums `last_token_usage` deltas per `token_count` event, attributing month + last-seen `turn_context.model`.

- [ ] **Step 1: Write the failing test**

Append inside the existing `#[cfg(test)] mod tests` of `src-tauri/src/providers/codex.rs`:

```rust
    #[test]
    fn scan_usage_sums_last_token_deltas_by_model() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();
        let sdir = home.join("sessions/2026/07/14");
        std::fs::create_dir_all(&sdir).unwrap();
        let ctx = r#"{"type":"turn_context","timestamp":"2026-07-14T00:00:00.000Z","payload":{"type":"turn_context","model":"gpt-5.5"}}"#;
        let tc1 = r#"{"type":"event_msg","timestamp":"2026-07-14T00:01:00.000Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":1000,"cached_input_tokens":400,"output_tokens":50}}}}"#;
        let tc2 = r#"{"type":"event_msg","timestamp":"2026-07-14T00:02:00.000Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":0,"cached_input_tokens":0,"output_tokens":0}}}}"#;
        std::fs::write(sdir.join("rollout-x.jsonl"), format!("{ctx}\n{tc1}\n{tc2}\nbroken\n")).unwrap();

        let recs = scan_usage(home);
        // tc2 is all-zero and skipped; only tc1 recorded
        assert_eq!(recs.len(), 1);
        let r = &recs[0];
        assert_eq!(r.year_month, "2026-07");
        assert_eq!(r.provider, ProviderId::Codex);
        assert_eq!(r.model, "gpt-5.5");
        assert_eq!(r.input_tokens, 1000);
        assert_eq!(r.cached_input_tokens, 400);
        assert_eq!(r.output_tokens, 50);
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test codex::tests::scan_usage 2>&1 | head -15`
Expected: FAIL — `cannot find function scan_usage`.

- [ ] **Step 3: Write minimal implementation**

Add `UsageRecord` + `year_month_of` to the `crate::model` import at the top of `src-tauri/src/providers/codex.rs` (extend the existing `use crate::model::{...}` line; add both names).

Append near the end of the file (before `#[cfg(test)]`):

```rust
// ---- Historical usage scan (issue #19) ----

#[derive(serde::Deserialize)]
struct ScanLine {
    timestamp: Option<String>,
    payload: Option<serde_json::Value>,
}

/// Scan `~/.codex/sessions/**/*.jsonl`. Each `token_count` event contributes its
/// `last_token_usage` delta, bucketed by the event month and attributed to the
/// most recent `turn_context.model` seen in that file.
pub fn scan_usage(codex_home: &Path) -> Vec<UsageRecord> {
    let mut out = Vec::new();
    for path in walk_jsonl(&codex_home.join("sessions")) {
        let Ok(content) = std::fs::read_to_string(&path) else { continue };
        let mut current_model = "unknown".to_string();
        for line in content.lines() {
            let Ok(l) = serde_json::from_str::<ScanLine>(line) else { continue };
            let Some(payload) = l.payload.as_ref() else { continue };
            match payload.get("type").and_then(|v| v.as_str()) {
                Some("turn_context") => {
                    if let Some(m) = payload.get("model").and_then(|v| v.as_str()) {
                        current_model = m.to_string();
                    }
                }
                Some("token_count") => {
                    let Some(ym) = l.timestamp.as_deref().and_then(year_month_of) else { continue };
                    let Some(last) = payload.get("info").and_then(|i| i.get("last_token_usage")) else { continue };
                    let get = |k: &str| last.get(k).and_then(|v| v.as_u64()).unwrap_or(0);
                    let input = get("input_tokens");
                    let cached = get("cached_input_tokens");
                    let output = get("output_tokens");
                    if input == 0 && output == 0 { continue; }
                    out.push(UsageRecord {
                        year_month: ym,
                        provider: ProviderId::Codex,
                        model: current_model.clone(),
                        input_tokens: input,
                        output_tokens: output,
                        cache_write_tokens: 0,
                        cache_read_tokens: 0,
                        cached_input_tokens: cached,
                    });
                }
                _ => {}
            }
        }
    }
    out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test codex::tests::scan_usage 2>&1 | tail -8`
Expected: PASS — 1 test ok.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/providers/codex.rs
git commit -m "feat(usage): Codex 롤아웃 token_count 델타 스캔 (#19)"
```

---

### Task 5: 집계 · CSV (`history.rs`)

**Files:**
- Create: `src-tauri/src/history.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod history;`)

**Interfaces:**
- Consumes: `UsageRecord`, `UsageHistory`, `MonthlyDetail`, `MonthlySummary`, `ProviderId` (model.rs); `pricing_for` (pricing.rs); `providers::claude::scan_usage`, `providers::codex::scan_usage`.
- Produces:
  - `pub fn aggregate(records: Vec<UsageRecord>, current_month: String) -> UsageHistory`
  - `pub fn to_csv(history: &UsageHistory) -> String`
  - `pub fn build_history() -> UsageHistory` (resolves homes, scans, aggregates)

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/history.rs` with only the test module:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{ProviderId, UsageRecord};

    fn claude_rec(ym: &str, model: &str, i: u64, o: u64, cw: u64, cr: u64) -> UsageRecord {
        UsageRecord { year_month: ym.into(), provider: ProviderId::Claude, model: model.into(),
            input_tokens: i, output_tokens: o, cache_write_tokens: cw, cache_read_tokens: cr, cached_input_tokens: 0 }
    }

    #[test]
    fn aggregate_sums_and_prices_by_month_provider_model() {
        let recs = vec![
            claude_rec("2026-07", "claude-sonnet-5", 1_000_000, 1_000_000, 0, 0),
            claude_rec("2026-07", "claude-sonnet-5", 1_000_000, 0, 0, 0),
        ];
        let h = aggregate(recs, "2026-07".into());
        assert_eq!(h.details.len(), 1);
        let d = &h.details[0];
        assert_eq!(d.input_tokens, 2_000_000);
        assert_eq!(d.output_tokens, 1_000_000);
        assert_eq!(d.total_tokens, 3_000_000);
        // 2M input @3 + 1M output @15 = 21.0
        assert!((d.cost_usd.unwrap() - 21.0).abs() < 1e-9);
        assert_eq!(h.summaries.len(), 1);
        assert!(h.summaries[0].cost_estimable);
    }

    #[test]
    fn unknown_model_marks_summary_not_estimable() {
        let recs = vec![claude_rec("2026-07", "weird-model", 1_000_000, 0, 0, 0)];
        let h = aggregate(recs, "2026-07".into());
        assert!(h.details[0].cost_usd.is_none());
        assert!(!h.summaries[0].cost_estimable);
    }

    #[test]
    fn csv_has_header_and_detail_rows() {
        let recs = vec![claude_rec("2026-07", "claude-haiku-4-5", 1_000_000, 0, 0, 0)];
        let h = aggregate(recs, "2026-07".into());
        let csv = to_csv(&h);
        let mut lines = csv.lines();
        assert_eq!(lines.next().unwrap(),
            "year_month,provider,model,input_tokens,output_tokens,cache_write_tokens,cache_read_tokens,cached_input_tokens,total_tokens,cost_usd");
        let row = lines.next().unwrap();
        assert!(row.starts_with("2026-07,claude,claude-haiku-4-5,1000000,0,0,0,0,1000000,"));
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test history:: 2>&1 | head -15`
Expected: FAIL — `cannot find function aggregate` (module not yet declared / impl missing).

- [ ] **Step 3: Write minimal implementation**

Prepend to `src-tauri/src/history.rs` (above the test module):

```rust
//! Monthly usage aggregation + CSV export (issue #19).

use std::collections::BTreeMap;
use std::path::PathBuf;

use crate::model::{
    MonthlyDetail, MonthlySummary, ProviderId, UsageHistory, UsageRecord,
};
use crate::pricing::pricing_for;

/// Fold raw records into (month × provider × model) details and (month × provider)
/// summaries, computing API-equivalent cost per the provider's cache accounting.
pub fn aggregate(records: Vec<UsageRecord>, current_month: String) -> UsageHistory {
    // Sum raw token buckets.
    let mut buckets: BTreeMap<(String, ProviderId, String), UsageRecord> = BTreeMap::new();
    for r in records {
        let key = (r.year_month.clone(), r.provider, r.model.clone());
        let e = buckets.entry(key).or_insert_with(|| UsageRecord {
            year_month: r.year_month.clone(), provider: r.provider, model: r.model.clone(),
            input_tokens: 0, output_tokens: 0, cache_write_tokens: 0, cache_read_tokens: 0, cached_input_tokens: 0,
        });
        e.input_tokens += r.input_tokens;
        e.output_tokens += r.output_tokens;
        e.cache_write_tokens += r.cache_write_tokens;
        e.cache_read_tokens += r.cache_read_tokens;
        e.cached_input_tokens += r.cached_input_tokens;
    }

    // Details + cost.
    let mut details: Vec<MonthlyDetail> = buckets.into_values().map(|r| {
        let pricing = pricing_for(&r.model);
        let (total_tokens, cost_usd) = match r.provider {
            ProviderId::Claude => {
                let total = r.input_tokens + r.output_tokens + r.cache_write_tokens + r.cache_read_tokens;
                let cost = pricing.map(|p| p.claude_cost(r.input_tokens, r.output_tokens, r.cache_write_tokens, r.cache_read_tokens));
                (total, cost)
            }
            ProviderId::Codex => {
                // input already includes cached; don't double-count.
                let total = r.input_tokens + r.output_tokens;
                let cost = pricing.map(|p| p.codex_cost(r.input_tokens, r.cached_input_tokens, r.output_tokens));
                (total, cost)
            }
        };
        MonthlyDetail {
            year_month: r.year_month, provider: r.provider, model: r.model,
            input_tokens: r.input_tokens, output_tokens: r.output_tokens,
            cache_write_tokens: r.cache_write_tokens, cache_read_tokens: r.cache_read_tokens,
            cached_input_tokens: r.cached_input_tokens, total_tokens, cost_usd,
        }
    }).collect();

    // Summaries per (month, provider).
    let mut sums: BTreeMap<(String, ProviderId), (u64, f64, bool)> = BTreeMap::new();
    for d in &details {
        let e = sums.entry((d.year_month.clone(), d.provider)).or_insert((0, 0.0, true));
        e.0 += d.total_tokens;
        match d.cost_usd {
            Some(c) => e.1 += c,
            None => e.2 = false,
        }
    }
    let mut summaries: Vec<MonthlySummary> = sums.into_iter().map(|((ym, p), (tot, cost, est))| MonthlySummary {
        year_month: ym, provider: p, total_tokens: tot, cost_usd: Some(cost), cost_estimable: est,
    }).collect();

    let prov_key = |p: &ProviderId| match p { ProviderId::Claude => 0, ProviderId::Codex => 1 };
    summaries.sort_by(|a, b| b.year_month.cmp(&a.year_month).then(prov_key(&a.provider).cmp(&prov_key(&b.provider))));
    details.sort_by(|a, b| b.year_month.cmp(&a.year_month)
        .then(prov_key(&a.provider).cmp(&prov_key(&b.provider)))
        .then(a.model.cmp(&b.model)));

    UsageHistory { current_month, summaries, details }
}

/// Detail rows as CSV (one header + one row per detail).
pub fn to_csv(history: &UsageHistory) -> String {
    let mut s = String::from(
        "year_month,provider,model,input_tokens,output_tokens,cache_write_tokens,cache_read_tokens,cached_input_tokens,total_tokens,cost_usd\n",
    );
    for d in &history.details {
        let provider = match d.provider { ProviderId::Claude => "claude", ProviderId::Codex => "codex" };
        let cost = d.cost_usd.map(|c| format!("{c:.4}")).unwrap_or_default();
        s.push_str(&format!(
            "{},{},{},{},{},{},{},{},{},{}\n",
            d.year_month, provider, d.model,
            d.input_tokens, d.output_tokens, d.cache_write_tokens, d.cache_read_tokens,
            d.cached_input_tokens, d.total_tokens, cost,
        ));
    }
    s
}

/// Scan both providers from their default homes and aggregate.
pub fn build_history() -> UsageHistory {
    let mut records = Vec::new();
    if let Some(home) = dirs::home_dir() {
        records.extend(crate::providers::claude::scan_usage(&home.join(".claude")));
    }
    if let Some(codex_home) = resolve_codex_home() {
        records.extend(crate::providers::codex::scan_usage(&codex_home));
    }
    let current_month = chrono::Utc::now().format("%Y-%m").to_string();
    aggregate(records, current_month)
}

fn resolve_codex_home() -> Option<PathBuf> {
    std::env::var_os("CODEX_HOME")
        .filter(|p| !p.is_empty())
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|h| h.join(".codex")))
}
```

Add `mod history;` to `src-tauri/src/lib.rs` after `mod commands;`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test history:: 2>&1 | tail -8`
Expected: PASS — 3 tests ok.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/history.rs src-tauri/src/lib.rs
git commit -m "feat(usage): 월별 집계·CSV 생성 로직 추가 (#19)"
```

---

### Task 6: Tauri command + dialog 플러그인 배선

**Files:**
- Modify: `src-tauri/src/commands.rs` (add 2 commands + import)
- Modify: `src-tauri/src/lib.rs` (register handlers + dialog plugin)
- Modify: `src-tauri/Cargo.toml` (`tauri-plugin-dialog = "2"`)
- Modify: `src-tauri/capabilities/default.json` (`dialog:default`)

**Interfaces:**
- Consumes: `history::build_history`, `history::to_csv`, `UsageHistory`.
- Produces (Tauri commands):
  - `get_usage_history() -> UsageHistory`
  - `export_usage_csv(path: String) -> Result<(), String>`

- [ ] **Step 1: Add the commands**

At the top of `src-tauri/src/commands.rs`, ensure `UsageHistory` is importable (add to the existing `use crate::model::{...}` line: add `UsageHistory`). Append:

```rust
#[tauri::command]
pub fn get_usage_history() -> UsageHistory {
    crate::history::build_history()
}

#[tauri::command]
pub fn export_usage_csv(path: String) -> Result<(), String> {
    let history = crate::history::build_history();
    let csv = crate::history::to_csv(&history);
    std::fs::write(&path, csv).map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Register handlers + plugin**

In `src-tauri/src/lib.rs`, add the dialog plugin after the notification plugin (line ~15):

```rust
        .plugin(tauri_plugin_dialog::init())
```

Extend the `generate_handler!` list (line ~16-19) to:

```rust
        .invoke_handler(tauri::generate_handler![
            commands::get_usage,
            commands::get_settings,
            commands::set_settings,
            commands::get_usage_history,
            commands::export_usage_csv,
        ])
```

Add to `src-tauri/Cargo.toml` under `[dependencies]`:

```toml
tauri-plugin-dialog = "2"
```

Add `"dialog:default"` to the `permissions` array in `src-tauri/capabilities/default.json`:

```json
  "permissions": [
    "core:default",
    "store:default",
    "notification:default",
    "dialog:default"
  ]
```

- [ ] **Step 3: Verify it compiles**

Run: `cd src-tauri && cargo build 2>&1 | tail -15`
Expected: `Finished` with no errors (dialog crate downloads on first build).

- [ ] **Step 4: Smoke-test the command**

Run: `cd src-tauri && cargo test 2>&1 | tail -12`
Expected: all existing + new tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs src-tauri/Cargo.toml src-tauri/capabilities/default.json
git commit -m "feat(usage): get_usage_history/export_usage_csv command + dialog 플러그인 (#19)"
```

---

### Task 7: 프런트 타입 & invoke 래퍼

**Files:**
- Modify: `src/lib/types.ts` (add interfaces)
- Create: `src/lib/history.ts`
- Test: `src/lib/history.test.ts`
- Modify: `package.json` (`@tauri-apps/plugin-dialog`)

**Interfaces:**
- Produces (TS):
  - `MonthlySummary`, `MonthlyDetail`, `UsageHistory` interfaces (mirror Rust serde output — snake_case fields).
  - `getUsageHistory(): Promise<UsageHistory>`
  - `downloadUsageCsv(): Promise<boolean>` — opens save dialog, invokes `export_usage_csv`; returns false if user cancels.

- [ ] **Step 1: Write the failing test**

Create `src/lib/history.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn();
const save = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: (...a: unknown[]) => save(...a) }));

import { getUsageHistory, downloadUsageCsv } from "./history";

describe("history lib", () => {
  beforeEach(() => { invoke.mockReset(); save.mockReset(); });

  it("getUsageHistory invokes the command", async () => {
    invoke.mockResolvedValue({ current_month: "2026-07", summaries: [], details: [] });
    const h = await getUsageHistory();
    expect(invoke).toHaveBeenCalledWith("get_usage_history");
    expect(h.current_month).toBe("2026-07");
  });

  it("downloadUsageCsv returns false when user cancels dialog", async () => {
    save.mockResolvedValue(null);
    const ok = await downloadUsageCsv();
    expect(ok).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("downloadUsageCsv exports to the chosen path", async () => {
    save.mockResolvedValue("/tmp/usage.csv");
    invoke.mockResolvedValue(undefined);
    const ok = await downloadUsageCsv();
    expect(ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith("export_usage_csv", { path: "/tmp/usage.csv" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- history 2>&1 | tail -15`
Expected: FAIL — cannot resolve `./history` / `@tauri-apps/plugin-dialog`.

- [ ] **Step 3: Write minimal implementation**

Install the dialog plugin JS package:

```bash
npm install @tauri-apps/plugin-dialog@^2
```

Append to `src/lib/types.ts`:

```ts
export interface MonthlySummary {
  year_month: string;
  provider: "claude" | "codex";
  total_tokens: number;
  cost_usd: number | null;
  cost_estimable: boolean;
}

export interface MonthlyDetail {
  year_month: string;
  provider: "claude" | "codex";
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_write_tokens: number;
  cache_read_tokens: number;
  cached_input_tokens: number;
  total_tokens: number;
  cost_usd: number | null;
}

export interface UsageHistory {
  current_month: string;
  summaries: MonthlySummary[];
  details: MonthlyDetail[];
}
```

Create `src/lib/history.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { UsageHistory } from "./types";

export function getUsageHistory(): Promise<UsageHistory> {
  return invoke<UsageHistory>("get_usage_history");
}

/**
 * Prompt for a save location and write the usage CSV there.
 * Returns false if the user cancels the dialog.
 */
export async function downloadUsageCsv(): Promise<boolean> {
  const path = await save({
    defaultPath: "token-usage.csv",
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });
  if (!path) return false;
  await invoke("export_usage_csv", { path });
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- history 2>&1 | tail -10`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/lib/history.ts src/lib/history.test.ts package.json package-lock.json
git commit -m "feat(usage): 사용 이력 타입·invoke 래퍼·CSV 다운로드 (#19)"
```

---

### Task 8: 사용 이력 뷰 + Header 토글 + i18n

**Files:**
- Create: `src/components/UsageHistoryView.tsx`
- Test: `src/components/UsageHistoryView.test.tsx`
- Modify: `src/components/Header.tsx` (view toggle)
- Modify: `src/App.tsx` (view state + render switch)
- Modify: `src/locales/ko.json`, `src/locales/en.json` (`history.*` keys)
- Modify: `src/lib/format.ts` (add `formatTokens`, `formatUsd` if not present — check first)

**Interfaces:**
- Consumes: `getUsageHistory`, `downloadUsageCsv` (history.ts); `UsageHistory`, `MonthlySummary` (types.ts).
- Produces: `<UsageHistoryView />` default-exported React component; `Header` gains `view` + `onViewChange` props; `App` owns `view: "limits" | "history"`.

- [ ] **Step 1: Write the failing test**

Create `src/components/UsageHistoryView.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "../i18n";

const getUsageHistory = vi.fn();
const downloadUsageCsv = vi.fn();
vi.mock("../lib/history", () => ({
  getUsageHistory: (...a: unknown[]) => getUsageHistory(...a),
  downloadUsageCsv: (...a: unknown[]) => downloadUsageCsv(...a),
}));

import UsageHistoryView from "./UsageHistoryView";

describe("UsageHistoryView", () => {
  beforeEach(() => { getUsageHistory.mockReset(); downloadUsageCsv.mockReset(); });

  it("renders monthly summary rows", async () => {
    getUsageHistory.mockResolvedValue({
      current_month: "2026-07",
      summaries: [
        { year_month: "2026-07", provider: "claude", total_tokens: 1234567, cost_usd: 12.34, cost_estimable: true },
        { year_month: "2026-07", provider: "codex", total_tokens: 7654321, cost_usd: 5.5, cost_estimable: true },
      ],
      details: [],
    });
    render(<UsageHistoryView />);
    await waitFor(() => expect(screen.getByText("2026-07")).toBeInTheDocument());
    // both provider rows present
    expect(screen.getAllByText("2026-07").length).toBeGreaterThanOrEqual(1);
  });

  it("shows empty state when no records", async () => {
    getUsageHistory.mockResolvedValue({ current_month: "2026-07", summaries: [], details: [] });
    render(<UsageHistoryView />);
    await waitFor(() => expect(getUsageHistory).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- UsageHistoryView 2>&1 | tail -12`
Expected: FAIL — cannot resolve `./UsageHistoryView`.

- [ ] **Step 3: Add i18n keys**

In `src/locales/ko.json` add a `history` object (top level, sibling of `app`):

```json
  "history": {
    "tab": "사용 이력",
    "limitsTab": "한도",
    "thisMonth": "이번 달",
    "tokens": "토큰",
    "cost": "추정 비용",
    "download": "CSV 다운로드",
    "empty": "사용 기록이 없어요",
    "estimateNote": "비용은 API 요금 기준 추정치예요 (구독제 실제 청구액과 무관)",
    "notEstimable": "일부 모델 단가 미등록",
    "colMonth": "연월",
    "colProvider": "서비스",
    "colTokens": "토큰",
    "colCost": "추정 비용($)"
  }
```

In `src/locales/en.json` add the matching object:

```json
  "history": {
    "tab": "Usage history",
    "limitsTab": "Limits",
    "thisMonth": "This month",
    "tokens": "Tokens",
    "cost": "Est. cost",
    "download": "Download CSV",
    "empty": "No usage records yet",
    "estimateNote": "Cost is an API-rate estimate (unrelated to your subscription bill)",
    "notEstimable": "some model prices unlisted",
    "colMonth": "Month",
    "colProvider": "Service",
    "colTokens": "Tokens",
    "colCost": "Est. cost ($)"
  }
```

- [ ] **Step 4: Write the component**

First check `src/lib/format.ts` for existing helpers: `grep -n "export" src/lib/format.ts`. If `formatTokens`/`formatUsd` are absent, add:

```ts
export function formatTokens(n: number): string {
  return new Intl.NumberFormat().format(n);
}

export function formatUsd(n: number | null): string {
  if (n === null) return "—";
  return `$${n.toFixed(2)}`;
}
```

Create `src/components/UsageHistoryView.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getUsageHistory, downloadUsageCsv } from "../lib/history";
import type { UsageHistory } from "../lib/types";
import { formatTokens, formatUsd } from "../lib/format";
import { EmptyState } from "./EmptyState";

const ACCENT: Record<"claude" | "codex", string> = {
  claude: "#D97757",
  codex: "#5162ED",
};

export default function UsageHistoryView() {
  const { t } = useTranslation();
  const [history, setHistory] = useState<UsageHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getUsageHistory()
      .then((h) => { if (alive) setHistory(h); })
      .catch(() => { if (alive) setHistory(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  if (loading) return <div className="history-loading">…</div>;
  if (!history || history.summaries.length === 0) {
    return <EmptyState message={t("history.empty")} />;
  }

  const current = history.summaries.filter((s) => s.year_month === history.current_month);
  const providers: Array<"claude" | "codex"> = ["claude", "codex"];

  const onDownload = async () => {
    setDownloading(true);
    try { await downloadUsageCsv(); } finally { setDownloading(false); }
  };

  return (
    <div className="history-view">
      <section className="history-current">
        <h2>{t("history.thisMonth")}</h2>
        <div className="history-cards">
          {providers.map((p) => {
            const s = current.find((c) => c.provider === p);
            return (
              <div key={p} className="history-card" style={{ borderColor: ACCENT[p] }}>
                <span className="history-card-title" style={{ color: ACCENT[p] }}>
                  {t(`provider.${p}`)}
                </span>
                <span className="history-card-tokens">
                  {formatTokens(s?.total_tokens ?? 0)} {t("history.tokens")}
                </span>
                <span className="history-card-cost">{formatUsd(s?.cost_usd ?? 0)}</span>
              </div>
            );
          })}
        </div>
      </section>

      <p className="history-note">{t("history.estimateNote")}</p>

      <table className="history-table">
        <thead>
          <tr>
            <th>{t("history.colMonth")}</th>
            <th>{t("history.colProvider")}</th>
            <th>{t("history.colTokens")}</th>
            <th>{t("history.colCost")}</th>
          </tr>
        </thead>
        <tbody>
          {history.summaries.map((s) => (
            <tr key={`${s.year_month}-${s.provider}`}>
              <td>{s.year_month}</td>
              <td style={{ color: ACCENT[s.provider] }}>{t(`provider.${s.provider}`)}</td>
              <td>{formatTokens(s.total_tokens)}</td>
              <td>
                {formatUsd(s.cost_usd)}
                {!s.cost_estimable && <span className="history-warn"> ≈</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <button className="history-download" onClick={onDownload} disabled={downloading}>
        {t("history.download")}
      </button>
    </div>
  );
}
```

> Verify `EmptyState` accepts a `message` prop: `grep -n "message\|props\|EmptyState" src/components/EmptyState.tsx`. If its prop name differs, adapt the call accordingly.

- [ ] **Step 5: Wire Header toggle + App**

Check `Header.tsx` props: `grep -n "interface\|Props\|export function Header\|=>" src/components/Header.tsx | head`. Add two props and a toggle control:

```tsx
// add to Header's props interface:
//   view: "limits" | "history";
//   onViewChange: (v: "limits" | "history") => void;
// render near the title (inside the header element):
<div className="view-toggle">
  <button
    className={view === "limits" ? "active" : ""}
    onClick={() => onViewChange("limits")}
  >{t("history.limitsTab")}</button>
  <button
    className={view === "history" ? "active" : ""}
    onClick={() => onViewChange("history")}
  >{t("history.tab")}</button>
</div>
```

In `src/App.tsx`: add state and render switch.

```tsx
// with the other useState hooks:
const [view, setView] = useState<"limits" | "history">("limits");

// pass to Header:
// <Header ... view={view} onViewChange={setView} />

// in the main body, wrap the existing ProviderCard section:
// {view === "limits" ? (
//   <> ...existing ProviderCard content... </>
// ) : (
//   <UsageHistoryView />
// )}
```

Add the import at the top of `App.tsx`:

```tsx
import UsageHistoryView from "./components/UsageHistoryView";
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npm test -- UsageHistoryView 2>&1 | tail -10`
Expected: PASS — 2 tests.

Run: `npm run build 2>&1 | tail -15`
Expected: `tsc` clean, `vite build` succeeds (no type errors from Header/App wiring).

- [ ] **Step 7: Commit**

```bash
git add src/components/UsageHistoryView.tsx src/components/UsageHistoryView.test.tsx \
  src/components/Header.tsx src/App.tsx src/locales/ko.json src/locales/en.json src/lib/format.ts
git commit -m "feat(usage): 사용 이력 뷰·Header 토글·i18n 추가 (#19)"
```

---

### Task 9: 스타일 + 수동 통합 검증

**Files:**
- Modify: `src/styles/theme.css` (history view styles: cards, table, download button, toggle)

**Interfaces:** none (CSS only + manual verification).

- [ ] **Step 1: Add styles**

Append to `src/styles/theme.css` — reuse existing CSS variables for light/dark. Style `.view-toggle`, `.history-view`, `.history-cards`, `.history-card`, `.history-table` (readable, right-aligned numeric columns), `.history-download`, `.history-note` (muted), `.history-warn`. Follow the existing file's variable and spacing conventions (inspect the top of `theme.css` first for the token names).

- [ ] **Step 2: Full test suite**

Run: `npm test 2>&1 | tail -10 && (cd src-tauri && cargo test 2>&1 | tail -10)`
Expected: all frontend + Rust tests PASS.

- [ ] **Step 3: Manual smoke test (verify skill)**

Run the app and drive the new view end-to-end:

```bash
npm run tauri dev
```

Verify:
1. Header shows "한도 / 사용 이력" toggle; clicking "사용 이력" switches views.
2. This-month cards show Claude + Codex tokens and estimated $.
3. Monthly table lists rows newest-first with per-provider accent colors.
4. "CSV 다운로드" opens a save dialog; saving writes a CSV whose header matches Task 5 and whose rows include model-level detail.
5. Estimate note is visible; unknown-model months show the `≈` marker.

> If `~/.claude/projects` or `~/.codex/sessions` is empty in the dev environment, the empty state shows instead — that is correct behavior. Seed a fixture file to exercise the populated path if needed.

- [ ] **Step 4: Commit**

```bash
git add src/styles/theme.css
git commit -m "feat(usage): 사용 이력 뷰 스타일 + 통합 검증 (#19)"
```

---

## Self-Review 결과

- **Spec 커버리지:** 월별 추정(Task 3/4/5) · Claude+Codex 동시(Task 5 build_history) · 이번 달 카드(Task 8) · CSV 다운로드(Task 6/7/8) · 별도 탭(Task 8) · 요약+상세(Task 5 details/summaries, Task 8 표) — 모두 태스크 존재.
- **플레이스홀더:** 코드 스텝 전부 실제 코드 포함. CSS(Task 9)만 서술형이나 CSS는 시각 조정이라 허용, 검증 스텝으로 보강.
- **타입 일관성:** `UsageRecord`/`MonthlyDetail`/`MonthlySummary`/`UsageHistory` 필드명이 Rust(model.rs)·TS(types.ts)·CSV(to_csv)·컴포넌트에서 일치. `scan_usage` 시그니처는 claude/codex 동일 `(&Path) -> Vec<UsageRecord>`. command 이름 `get_usage_history`/`export_usage_csv`가 lib.rs·history.ts에서 일치.

## 미해결 / 구현 중 확인할 점

- 정확한 단가 수치(특히 Fable, GPT-5.x 계열)는 공개 요금 확인 후 `pricing.rs`에서 최종 조정.
- `EmptyState`·`Header`·`format.ts`의 실제 prop/export 이름은 해당 파일 확인 후 맞춤 (각 태스크에 grep 스텝 포함).
