# pricing.rs 세대 인지 요율 개편 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pricing_for`를 세대 인지(Opus 4.1 vs 4.8) + 날짜 인지(Sonnet 5 인트로 프로모) 매칭으로 바꿔 issue #28의 과다/과소 청구를 교정한다.

**Architecture:** substring 매칭 구조는 유지하되, opus/sonnet/codex 계열에 세대·날짜 분기를 추가한다. `pricing_for`에 `year_month: &str` 인자를 주입하고, 비용 계산 메서드(`claude_cost`/`codex_cost`)와 `ModelPricing` 구조체는 불변으로 둔다(요율 선택과 계산의 관심사 분리).

**Tech Stack:** Rust, cargo. 테스트는 `src-tauri/`에서 `cargo test`.

## Global Constraints

- 작업 디렉터리: cargo 명령은 `src-tauri/`에서 실행 (WSL 빌드 셋업 참조).
- 요율 단위: MTok당 USD.
- 캐시 배수 규칙: `cache_write = input × 1.25`, `cache_read = input × 0.1` (Claude 계열).
- `ModelPricing` 구조체 필드와 `claude_cost`/`codex_cost` 시그니처는 변경 금지.
- Codex 수치(gpt-5.5 = 5/30, gpt-5.3-codex = 1.75/14)는 이슈 명시값 — 독립 검증 없음.

---

## File Structure

- `src-tauri/src/pricing.rs` — `pricing_for` 시그니처·본문 개편, 테스트 갱신/추가.
- `src-tauri/src/history.rs` — 호출부 1줄 갱신(라인 33).

---

### Task 1: 시그니처 개편 + 전체 세대/날짜 분기 구현

기존 2개 테스트를 새 기대값으로 고쳐 red를 만든 뒤, `pricing_for` 전체를 구현하고 호출부를 갱신해 green으로 만든다. Rust 모듈 전체 컴파일 특성상 시그니처 변경은 원자적으로 이뤄진다.

**Files:**
- Modify: `src-tauri/src/pricing.rs:41-62` (`pricing_for` 본문), `src-tauri/src/pricing.rs:68-88` (기존 테스트)
- Modify: `src-tauri/src/history.rs:33`

**Interfaces:**
- Produces: `pub fn pricing_for(model: &str, year_month: &str) -> Option<ModelPricing>`

- [ ] **Step 1: 기존 테스트 2개를 새 기대값 + 새 시그니처로 수정 (failing 유도)**

`src-tauri/src/pricing.rs`의 테스트 모듈에서 두 테스트를 교체:

```rust
    #[test]
    fn claude_opus_cost_sums_all_buckets() {
        // opus-4-8 is current-gen → 5/25, cache 6.25/0.50
        let p = pricing_for("claude-opus-4-8", "2026-07").unwrap();
        let cost = p.claude_cost(1_000_000, 1_000_000, 1_000_000, 1_000_000);
        assert!((cost - (5.0 + 25.0 + 6.25 + 0.50)).abs() < 1e-9);
    }

    #[test]
    fn codex_cost_excludes_cached_from_input_rate() {
        let p = pricing_for("gpt-5.5", "2026-07").unwrap();
        // input_total 1M with 400k cached: 600k @5 + 400k @0.50 + 1M output @30
        let cost = p.codex_cost(1_000_000, 400_000, 1_000_000);
        let expected = 0.6 * 5.0 + 0.4 * 0.50 + 30.0;
        assert!((cost - expected).abs() < 1e-9);
    }
```

또한 `unknown_model_has_no_pricing`의 호출을 `pricing_for("mystery-model-9", "2026-07")`로 갱신.

- [ ] **Step 2: 테스트 실행해 컴파일 실패(인자 개수 불일치) 확인**

Run: `cd src-tauri && cargo test pricing 2>&1 | head -30`
Expected: 컴파일 에러 — `pricing_for` 인자 개수 불일치.

- [ ] **Step 3: `pricing_for` 본문을 세대/날짜 분기로 교체**

`src-tauri/src/pricing.rs`의 `pricing_for` 전체(라인 39-62)를 교체:

```rust
/// Look up pricing by model id (case-insensitive substring match).
/// `year_month` ("YYYY-MM") drives date-sensitive rates (e.g. Sonnet 5 intro).
/// Returns None for unknown models so callers can flag "estimate unavailable".
pub fn pricing_for(model: &str, year_month: &str) -> Option<ModelPricing> {
    let m = model.to_ascii_lowercase();
    // --- Claude family (cache fields separate) ---
    if m.contains("opus") {
        // Legacy Opus (4.1, 4.0, Opus 3) = 15/75; current gen (4.5–4.8) = 5/25.
        let legacy = m.contains("opus-4-1") || m.contains("opus-4-0")
            || m.contains("opus-3") || m.contains("3-opus");
        return Some(if legacy {
            ModelPricing { input: 15.0, output: 75.0, cache_write: 18.75, cache_read: 1.5, cached_input: 0.0 }
        } else {
            ModelPricing { input: 5.0, output: 25.0, cache_write: 6.25, cache_read: 0.50, cached_input: 0.0 }
        });
    }
    if m.contains("sonnet") {
        // Sonnet 5 intro pricing (2/10) through 2026-08; standard 3/15 otherwise.
        let intro = m.contains("sonnet-5") && year_month <= "2026-08";
        return Some(if intro {
            ModelPricing { input: 2.0, output: 10.0, cache_write: 2.5, cache_read: 0.20, cached_input: 0.0 }
        } else {
            ModelPricing { input: 3.0, output: 15.0, cache_write: 3.75, cache_read: 0.30, cached_input: 0.0 }
        });
    }
    if m.contains("haiku") {
        return Some(ModelPricing { input: 1.0, output: 5.0, cache_write: 1.25, cache_read: 0.10, cached_input: 0.0 });
    }
    if m.contains("fable") {
        return Some(ModelPricing { input: 10.0, output: 50.0, cache_write: 12.5, cache_read: 1.0, cached_input: 0.0 });
    }
    // --- Codex / OpenAI GPT-5 family (input includes cached) ---
    // Order matters: gpt-5.5 contains "gpt-5", gpt-5.3-codex-spark contains "codex".
    if m.contains("gpt-5.3-codex") {
        // Covers gpt-5.3-codex and gpt-5.3-codex-spark. Spark rate is a third-party
        // aggregate, not on OpenAI's official API pricing page — reconfirm before final.
        return Some(ModelPricing { input: 1.75, output: 14.0, cache_write: 0.0, cache_read: 0.0, cached_input: 0.175 });
    }
    if m.contains("gpt-5.5") {
        return Some(ModelPricing { input: 5.0, output: 30.0, cache_write: 0.0, cache_read: 0.0, cached_input: 0.50 });
    }
    if m.contains("gpt-5") || m.contains("codex") {
        return Some(ModelPricing { input: 1.25, output: 10.0, cache_write: 0.0, cache_read: 0.0, cached_input: 0.125 });
    }
    None
}
```

- [ ] **Step 4: 호출부 갱신**

`src-tauri/src/history.rs:33`:

```rust
        let pricing = pricing_for(&r.model, &r.year_month);
```

- [ ] **Step 5: 테스트 실행해 green 확인**

Run: `cd src-tauri && cargo test pricing 2>&1 | tail -20`
Expected: 3개 테스트 PASS.

- [ ] **Step 6: 전체 빌드/테스트로 호출부 회귀 확인**

Run: `cd src-tauri && cargo test 2>&1 | tail -20`
Expected: 전체 PASS (history.rs 포함).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/pricing.rs src-tauri/src/history.rs
git commit -m "fix(pricing): 세대·날짜 인지 요율 매칭 (#28)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: 세대/날짜 분기 커버리지 테스트 추가

Task 1이 구현한 각 분기(레거시 opus, fable, sonnet 프로모/프로모후, codex 3.3/spark)를 잠그는 테스트를 추가한다.

**Files:**
- Modify: `src-tauri/src/pricing.rs` (테스트 모듈)

**Interfaces:**
- Consumes: `pricing_for(model, year_month)` (Task 1)

- [ ] **Step 1: 커버리지 테스트 추가**

테스트 모듈에 추가:

```rust
    #[test]
    fn opus_legacy_keeps_15_75() {
        let p = pricing_for("claude-opus-4-1", "2026-07").unwrap();
        assert_eq!((p.input, p.output, p.cache_write, p.cache_read), (15.0, 75.0, 18.75, 1.5));
    }

    #[test]
    fn opus_current_gen_is_5_25() {
        let p = pricing_for("claude-opus-4-8", "2026-07").unwrap();
        assert_eq!((p.input, p.output, p.cache_write, p.cache_read), (5.0, 25.0, 6.25, 0.50));
    }

    #[test]
    fn fable_is_10_50() {
        let p = pricing_for("claude-fable-5", "2026-07").unwrap();
        assert_eq!((p.input, p.output, p.cache_write, p.cache_read), (10.0, 50.0, 12.5, 1.0));
    }

    #[test]
    fn sonnet5_intro_promo_before_september() {
        let p = pricing_for("claude-sonnet-5", "2026-07").unwrap();
        assert_eq!((p.input, p.output), (2.0, 10.0));
    }

    #[test]
    fn sonnet5_standard_rate_after_promo() {
        let p = pricing_for("claude-sonnet-5", "2026-09").unwrap();
        assert_eq!((p.input, p.output), (3.0, 15.0));
    }

    #[test]
    fn legacy_sonnet_never_gets_promo() {
        let p = pricing_for("claude-sonnet-4-6", "2026-07").unwrap();
        assert_eq!((p.input, p.output), (3.0, 15.0));
    }

    #[test]
    fn gpt_53_codex_is_1_75_14() {
        let p = pricing_for("gpt-5.3-codex", "2026-07").unwrap();
        assert_eq!((p.input, p.output, p.cached_input), (1.75, 14.0, 0.175));
    }

    #[test]
    fn gpt_53_codex_spark_matches_codex() {
        let p = pricing_for("gpt-5.3-codex-spark", "2026-07").unwrap();
        assert_eq!((p.input, p.output, p.cached_input), (1.75, 14.0, 0.175));
    }
```

- [ ] **Step 2: 테스트 실행해 green 확인**

Run: `cd src-tauri && cargo test pricing 2>&1 | tail -25`
Expected: 신규 8개 포함 전체 PASS.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/pricing.rs
git commit -m "test(pricing): 세대·프로모 분기 커버리지 (#28)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** opus 레거시/현행, sonnet 프로모/표준, haiku, fable, gpt-5.5, gpt-5.3-codex(-spark), 미식별 None — 모두 태스크로 커버.
- **Type consistency:** 전 태스크에서 `pricing_for(&str, &str) -> Option<ModelPricing>` 일관. `ModelPricing` 필드명(`input`/`output`/`cache_write`/`cache_read`/`cached_input`) 불변.
- **알려진 단순화:** `opus-4-1` substring이 존재하지 않는 `opus-4-10`과 충돌 가능(현실 무시). 스펙에 기록됨.
