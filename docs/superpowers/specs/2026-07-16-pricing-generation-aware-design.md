# pricing.rs 세대 인지 요율 개편 (issue #28)

- **날짜:** 2026-07-16
- **이슈:** [#28](https://github.com/donghoon-bigvalue/token-usage-app/issues/28) — pricing.rs 요율이 현행 모델 세대와 불일치 (Opus 3배 과다·Fable/Codex 과소)
- **범위:** `src-tauri/src/pricing.rs` + 호출부 `src-tauri/src/history.rs` 1줄

## 배경

`pricing_for(&r.model)`는 `history.rs`의 월별 집계(`aggregate`)에서 호출된다. 데이터는 **월 × 프로바이더 × 모델** 로 집계된 과거 사용 기록이고, `model` 문자열은 로그에 기록된 실제 모델 ID(`claude-opus-4-8`, `gpt-5.5` 등) 그대로다. 따라서 사용자가 과거에 레거시 모델(`claude-opus-4-1` 등)을 썼다면 그 문자열이 데이터에 실재할 수 있다.

현재 구현은 coarse substring 매칭이라 (1) 세대 구분(Opus 4.1 vs 4.8), (2) 프로모(Sonnet 5 인트로가)를 표현하지 못한다. 단순 요율 교체만으로는 레거시 사용분이 반대로 틀어진다(예: `opus`를 5/25로 바꾸면 실제 15/75인 `opus-4-1` 사용분이 과소청구).

Claude 측 요율은 claude-api 스킬의 권위 가격표(cached 2026-06-24)로 대조 검증했다. Codex/OpenAI 측 수치는 이슈에 명시된 값을 신뢰하되 독립 검증 출처는 없다(claude-api 스킬은 OpenAI 가격 미포함).

## 결정 사항

1. **매칭 방식:** substring 유지하되 세대 구분 분기 추가 (요율만 교체 X)
2. **Sonnet 5 프로모:** 날짜 인지 반영 — `pricing_for`에 `year_month` 주입
3. **gpt-5.3-codex-spark:** gpt-5.3-codex와 동일 요율 + 재확인 주석

## 설계

### 시그니처

```rust
pub fn pricing_for(model: &str, year_month: &str) -> Option<ModelPricing>
```

- 호출부 `history.rs:33`: `pricing_for(&r.model, &r.year_month)` — 라인 48의 `r.year_month` move 이전 borrow라 안전.
- `ModelPricing` 구조체, `claude_cost`, `codex_cost`는 **불변**. 세대/날짜 분기는 요율 *선택*에만 존재하고 비용 계산식은 그대로. 관심사 분리 유지.

### Claude 세대 분기

매칭 순서와 요율(MTok, USD):

| # | 조건 | input / output | cache write / read |
|---|---|---|---|
| 1 | `opus` **레거시**: `opus-4-1` OR `opus-4-0` OR `opus-3` OR `3-opus` | 15 / 75 | 18.75 / 1.5 |
| 2 | `opus` **현행** (그 외 모든 opus: 4.5~4.8, 미식별) | 5 / 25 | 6.25 / 0.50 |
| 3 | `sonnet-5` AND `year_month <= "2026-08"` (인트로 프로모) | 2 / 10 | 2.5 / 0.20 |
| 4 | `sonnet` (그 외: 프로모 종료 후 sonnet-5, 4.6, 4.5 …) | 3 / 15 | 3.75 / 0.30 |
| 5 | `haiku` | 1 / 5 | 1.25 / 0.10 |
| 6 | `fable` | 10 / 50 | 12.5 / 1.0 |

규칙:
- 레거시 opus는 **명시 열거**, 미식별 opus는 현행(5/25)으로 기본값 → 미래 버전도 안전한 쪽으로 수렴.
- 프로모 판정은 `"YYYY-MM"` 문자열 사전식 비교(`year_month <= "2026-08"`). 인트로가는 ~2026-08-31이므로 2026-08 사용분까지 2/10, 2026-09부터 3/15.
- 캐시 배수는 공식 규칙(write = input × 1.25, read = input × 0.1)을 각 기준요율에 적용.

**알려진 단순화:** `opus-4-1` substring은 존재하지 않는 `opus-4-10`과 충돌 가능하나, 해당 버전이 없어 실무상 무시.

### Codex / OpenAI 세대 분기

매칭 순서(구체적인 것 우선 — substring 포함 관계 때문):

| # | 조건 | input / output / cached |
|---|---|---|
| 1 | `gpt-5.3-codex` (spark 포함 — spark 문자열이 이 substring 함유) | 1.75 / 14 / 0.175 |
| 2 | `gpt-5.5` | 5 / 30 / 0.50 |
| 3 | `gpt-5` OR `codex` (레거시 베이스 fallback) | 1.25 / 10 / 0.125 |

- `gpt-5.3-codex-spark`엔 주석: `// 제3자 집계값, OpenAI 공식 가격표 미등재 — 재확인 필요`.
- 순서 필수: `gpt-5.5`는 `gpt-5`를 포함하고, `gpt-5.3-codex`는 `codex`를 포함하므로 구체 조건을 먼저 검사.

### 미식별 모델

세 계열 어디에도 안 걸리면 `None` 반환 → 호출부가 `cost_estimable = false`로 플래그(기존 동작 유지).

## 테스트 (TDD)

기존 2개 갱신(시그니처 + 기대 요율):
- `claude_opus_cost_sums_all_buckets`: `pricing_for("claude-opus-4-8", "2026-07")` → 15/75 기대 → **5/25** 로 수정.
- `codex_cost_excludes_cached_from_input_rate`: `pricing_for("gpt-5.5", "2026-07")` → 1.25/10 기대 → **5/30** 로 수정.
- `unknown_model_has_no_pricing`: 시그니처만 갱신.

신규:
- opus 레거시 `claude-opus-4-1` → 15/75
- opus 현행 `claude-opus-4-8` → 5/25 (위 갱신 테스트와 겹치면 통합)
- `claude-fable-5` → 10/50
- sonnet-5 프로모 `claude-sonnet-5` @ `"2026-07"` → 2/10
- sonnet-5 프로모후 `claude-sonnet-5` @ `"2026-09"` → 3/15
- sonnet 레거시 `claude-sonnet-4-6` @ 아무 달 → 3/15 (프로모 미적용)
- `gpt-5.3-codex` → 1.75/14/0.175
- `gpt-5.3-codex-spark` → 1.75/14/0.175 (codex와 동일 확인)

## 비범위

- 프론트엔드/xlsx 변경 없음 (백엔드가 계산한 `cost_usd`만 소비).
- Codex 수치 독립 검증 없음 — 이슈 명시값 신뢰.
- pricing_for 구조를 enum 기반 모델 레지스트리로 전면 재작성하는 것은 이번 범위 밖(YAGNI). substring + 세대 분기로 충분.
