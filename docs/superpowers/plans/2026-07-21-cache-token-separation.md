# 캐시 토큰 분리 표시 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용 이력의 대표 수치를 캐시 읽기가 제외된 "직접 사용"(`direct_tokens`)으로 바꾸고, 캐시 버킷을 카드·테이블·xlsx에서 분리 표시한다.

**Architecture:** 프로바이더별 캐시 회계 정규화는 Rust `history.rs`의 `display_buckets()` 헬퍼 한 곳에만 존재한다. `MonthlyDetail`은 원시 버킷 + `direct_tokens`를, `MonthlySummary`는 정규화된 4버킷 + `direct_tokens`를 들고 내려온다. 프런트는 계산하지 않고 렌더만 한다. `total_tokens`의 정의와 값은 건드리지 않는다.

**Tech Stack:** Rust (Tauri backend, `cargo test`), React + TypeScript, react-i18next, vitest + @testing-library/react, rust_xlsxwriter / calamine.

## Global Constraints

- `total_tokens`의 계산식과 값은 변경 금지. 새 필드만 추가한다.
- `cost_usd` 계산 로직 변경 금지.
- Codex 정규화는 `saturating_sub`를 쓴다. u64 언더플로는 릴리스 빌드에서 조용히 거대한 쓰레기 값이 된다.
- 정규화 규칙은 `display_buckets()` 한 곳에만 존재한다. TypeScript 쪽에 같은 규칙을 두지 않는다.
- 네 표시 버킷의 합은 항상 `total_tokens`와 같아야 한다.
- 토큰 축약 표기("2.15B") 도입 금지. 기존 `formatTokens`(콤마 구분 전체 자릿수)를 그대로 쓴다.
- Rust 테스트: `cd src-tauri && cargo test`. 프런트 테스트: `npm test`. 타입체크: `npm run build`.
- 커밋 메시지는 한국어 본문, Conventional Commits 접두사, `(#43)` 참조.

---

### Task 1: 백엔드 — 정규화 버킷과 `direct_tokens`

**Files:**
- Modify: `src-tauri/src/model.rs:85-108` (`MonthlyDetail`, `MonthlySummary`)
- Modify: `src-tauri/src/history.rs:15-72` (`aggregate`)
- Test: `src-tauri/src/history.rs` (`mod tests`, 파일 하단)

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces:
  - `MonthlyDetail.direct_tokens: u64`
  - `MonthlySummary.input_tokens / output_tokens / cache_read_tokens / cache_write_tokens / direct_tokens: u64`
  - `fn display_buckets(p: ProviderId, input: u64, output: u64, cache_write: u64, cache_read: u64, cached_input: u64) -> DisplayBuckets` (crate-private, `history.rs`)
  - `struct DisplayBuckets { input, output, cache_read, cache_write: u64 }` + `fn direct(&self) -> u64`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src-tauri/src/history.rs`의 `mod tests` 안, 기존 `claude_rec` 헬퍼 바로 아래에 `codex_rec` 헬퍼를 추가하고 테스트 4개를 파일 하단(`mod tests`의 닫는 중괄호 직전)에 붙인다.

```rust
    fn codex_rec(ym: &str, model: &str, i: u64, o: u64, cached: u64) -> UsageRecord {
        UsageRecord { year_month: ym.into(), provider: ProviderId::Codex, model: model.into(),
            input_tokens: i, output_tokens: o, cache_write_tokens: 0, cache_read_tokens: 0,
            cached_input_tokens: cached }
    }

    #[test]
    fn claude_direct_excludes_cache_but_total_still_includes_it() {
        let recs = vec![claude_rec("2026-07", "claude-sonnet-5", 100, 20, 300, 5_000)];
        let h = aggregate(recs, "2026-07".into(), 1_700_000_000);
        let d = &h.details[0];
        assert_eq!(d.direct_tokens, 120);
        // Regression guard: the headline change must not move `total_tokens`.
        assert_eq!(d.total_tokens, 5_420);

        let s = &h.summaries[0];
        assert_eq!(s.direct_tokens, 120);
        assert_eq!(s.input_tokens, 100);
        assert_eq!(s.output_tokens, 20);
        assert_eq!(s.cache_read_tokens, 5_000);
        assert_eq!(s.cache_write_tokens, 300);
        assert_eq!(s.total_tokens, 5_420);
    }

    #[test]
    fn codex_direct_strips_cached_input_so_both_providers_mean_the_same_thing() {
        // Codex reports cached reads *inside* `input`, so 9_000 of the 10_000
        // input tokens were cache hits and only 1_000 were newly sent.
        let recs = vec![codex_rec("2026-07", "gpt-5.5", 10_000, 500, 9_000)];
        let h = aggregate(recs, "2026-07".into(), 1_700_000_000);
        let d = &h.details[0];
        assert_eq!(d.direct_tokens, 1_500);
        assert_eq!(d.total_tokens, 10_500);

        let s = &h.summaries[0];
        assert_eq!(s.input_tokens, 1_000);
        assert_eq!(s.output_tokens, 500);
        assert_eq!(s.cache_read_tokens, 9_000);
        assert_eq!(s.cache_write_tokens, 0);
        assert_eq!(s.direct_tokens, 1_500);
    }

    #[test]
    fn malformed_codex_record_with_cached_over_input_does_not_underflow() {
        // A log where cached > input is nonsense, but u64 underflow would turn
        // it into ~1.8e19 tokens on screen (or a debug-build panic).
        let recs = vec![codex_rec("2026-07", "gpt-5.5", 100, 40, 900)];
        let h = aggregate(recs, "2026-07".into(), 1_700_000_000);
        assert_eq!(h.details[0].direct_tokens, 40);
        assert_eq!(h.summaries[0].input_tokens, 0);
    }

    #[test]
    fn display_buckets_always_sum_to_total_tokens() {
        let recs = vec![
            claude_rec("2026-07", "claude-sonnet-5", 100, 20, 300, 5_000),
            claude_rec("2026-07", "claude-haiku-4-5", 7, 3, 0, 90),
            codex_rec("2026-07", "gpt-5.5", 10_000, 500, 9_000),
        ];
        let h = aggregate(recs, "2026-07".into(), 1_700_000_000);
        assert_eq!(h.summaries.len(), 2);
        for s in &h.summaries {
            assert_eq!(
                s.input_tokens + s.output_tokens + s.cache_read_tokens + s.cache_write_tokens,
                s.total_tokens,
                "buckets must reconcile for {:?}", s.provider
            );
            assert_eq!(s.direct_tokens, s.input_tokens + s.output_tokens);
        }
        // Claude summary folds both models together.
        let claude = h.summaries.iter().find(|s| s.provider == ProviderId::Claude).unwrap();
        assert_eq!(claude.direct_tokens, 130);
        assert_eq!(claude.cache_read_tokens, 5_090);
    }
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `cd src-tauri && cargo test --lib history`
Expected: FAIL — 컴파일 에러 `no field 'direct_tokens' on type 'MonthlyDetail'` 및 `MonthlySummary`

- [ ] **Step 3: 모델에 필드를 추가한다**

`src-tauri/src/model.rs`에서 `MonthlyDetail`의 `cached_input_tokens` 다음, `total_tokens` 앞에 삽입:

```rust
    /// Tokens the user actually spent: input + output with the provider's cache
    /// accounting normalized away. Comparable across providers, unlike
    /// `total_tokens`. See `history::display_buckets`.
    pub direct_tokens: u64,
```

`MonthlySummary`의 `provider` 다음, `total_tokens` 앞에 삽입:

```rust
    /// Display-normalized buckets — these four always sum to `total_tokens`.
    /// The names describe what the user sees, not the raw log field: for Codex
    /// `input_tokens` has its cached reads stripped out and `cache_read_tokens`
    /// comes from `cached_input_tokens`.
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    /// `input_tokens + output_tokens`. The headline number on screen.
    pub direct_tokens: u64,
```

- [ ] **Step 4: `display_buckets` 헬퍼를 추가한다**

`src-tauri/src/history.rs`에서 `pub fn aggregate` 정의 **바로 위**에 추가:

```rust
/// The four buckets the UI shows, normalized so both providers mean the same
/// thing. Claude reports cache reads in their own field; Codex folds them into
/// `input_tokens` and breaks them out as `cached_input_tokens`, and has no
/// cache-write concept at all. Every display path goes through here so the
/// rule lives in exactly one place.
struct DisplayBuckets {
    input: u64,
    output: u64,
    cache_read: u64,
    cache_write: u64,
}

impl DisplayBuckets {
    fn direct(&self) -> u64 {
        self.input + self.output
    }
}

fn display_buckets(
    p: ProviderId, input: u64, output: u64,
    cache_write: u64, cache_read: u64, cached_input: u64,
) -> DisplayBuckets {
    match p {
        ProviderId::Claude => DisplayBuckets { input, output, cache_read, cache_write },
        // `saturating_sub` guards a malformed log where cached exceeds input —
        // u64 underflow would surface as ~1.8e19 tokens rather than an error.
        ProviderId::Codex => DisplayBuckets {
            input: input.saturating_sub(cached_input),
            output,
            cache_read: cached_input,
            cache_write: 0,
        },
    }
}

/// Running totals for one (month, provider) summary. A tuple stopped being
/// readable once there were six things to accumulate.
#[derive(Default)]
struct SummaryAcc {
    total: u64,
    input: u64,
    output: u64,
    cache_read: u64,
    cache_write: u64,
    cost: f64,
    estimable: bool,
}
```

- [ ] **Step 5: `aggregate`의 detail 생성부에서 `direct_tokens`를 채운다**

`src-tauri/src/history.rs`의 detail `map` 클로저를 아래로 교체한다. `total_tokens`와 `cost` 계산식은 **그대로 두고** direct만 추가한다.

```rust
    let mut details: Vec<MonthlyDetail> = buckets.into_values().map(|r| {
        let pricing = pricing_for(&r.model, &r.year_month);
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
        let direct_tokens = display_buckets(
            r.provider, r.input_tokens, r.output_tokens,
            r.cache_write_tokens, r.cache_read_tokens, r.cached_input_tokens,
        ).direct();
        MonthlyDetail {
            year_month: r.year_month, provider: r.provider, model: r.model,
            input_tokens: r.input_tokens, output_tokens: r.output_tokens,
            cache_write_tokens: r.cache_write_tokens, cache_read_tokens: r.cache_read_tokens,
            cached_input_tokens: r.cached_input_tokens, direct_tokens, total_tokens, cost_usd,
        }
    }).collect();
```

- [ ] **Step 6: 요약 합산 루프를 누적 구조체로 바꾼다**

`src-tauri/src/history.rs`의 `// Summaries per (month, provider).` 블록 전체(`sums` 선언부터 `summaries` collect까지)를 교체한다.

```rust
    // Summaries per (month, provider).
    let mut sums: BTreeMap<(String, ProviderId), SummaryAcc> = BTreeMap::new();
    for d in &details {
        let e = sums.entry((d.year_month.clone(), d.provider))
            .or_insert_with(|| SummaryAcc { estimable: true, ..SummaryAcc::default() });
        let b = display_buckets(
            d.provider, d.input_tokens, d.output_tokens,
            d.cache_write_tokens, d.cache_read_tokens, d.cached_input_tokens,
        );
        e.total += d.total_tokens;
        e.input += b.input;
        e.output += b.output;
        e.cache_read += b.cache_read;
        e.cache_write += b.cache_write;
        match d.cost_usd {
            Some(c) => e.cost += c,
            None => e.estimable = false,
        }
    }
    let mut summaries: Vec<MonthlySummary> = sums.into_iter().map(|((ym, p), a)| MonthlySummary {
        year_month: ym, provider: p,
        input_tokens: a.input, output_tokens: a.output,
        cache_read_tokens: a.cache_read, cache_write_tokens: a.cache_write,
        direct_tokens: a.input + a.output,
        total_tokens: a.total, cost_usd: Some(a.cost), cost_estimable: a.estimable,
    }).collect();
```

- [ ] **Step 7: 테스트가 통과하는지 확인한다**

Run: `cd src-tauri && cargo test --lib`
Expected: PASS — 신규 4개 포함 전부 통과. `xlsx.rs`가 `MonthlyDetail`을 직접 만드는 테스트 헬퍼를 갖고 있지 않으므로(`aggregate`를 거친다) 컴파일도 함께 통과해야 한다. 만약 `missing field direct_tokens` 에러가 나면 해당 리터럴에 `direct_tokens: 0`이 아니라 실제 값을 채워 넣는다.

- [ ] **Step 8: 커밋**

```bash
git add src-tauri/src/model.rs src-tauri/src/history.rs
git commit -m "feat(history): 프로바이더 정규화 direct_tokens·캐시 버킷 집계 (#43)

캐시 회계 정규화를 display_buckets() 한 곳으로 모으고, detail에
direct_tokens를, summary에 정규화된 4버킷과 direct_tokens를 추가한다.
total_tokens 계산식은 그대로 둔다.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: xlsx `Direct tokens` 컬럼

**Files:**
- Modify: `src-tauri/src/xlsx.rs:14-50` (`Labels`, `EN`, `KO`, `token_cells`)
- Modify: `src-tauri/src/xlsx.rs:88-114` (`write_sheet` 본문의 컬럼 인덱스)
- Test: `src-tauri/src/xlsx.rs` (`mod tests`)

**Interfaces:**
- Consumes: `MonthlyDetail.direct_tokens` (Task 1)
- Produces: 11컬럼 시트. 컬럼 순서 — 0 Month / 1 Provider / 2 Model / 3 Input / 4 Output / 5 Cache write / 6 Cache read / 7 Cached input / 8 Direct / 9 Total / 10 Cost

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src-tauri/src/xlsx.rs`의 `english_sheet_has_header_detail_and_total_rows` 테스트를 아래로 교체하고, 그 아래에 신규 테스트를 추가한다.

```rust
    #[test]
    fn english_sheet_has_header_detail_and_total_rows() {
        let h = aggregate(vec![rec("2026-07", ProviderId::Claude, "claude-sonnet-5", 1_000_000, 1_000_000)], "2026-07".into(), 1_700_000_000);
        let mut wb = open(to_xlsx(&h).unwrap());
        let r = rows(&mut wb, "Usage");

        assert_eq!(text(&r[0][0]), "Month");
        assert_eq!(text(&r[0][1]), "Provider");
        assert_eq!(text(&r[0][2]), "Model");
        assert_eq!(text(&r[0][8]), "Direct tokens");
        assert_eq!(text(&r[0][9]), "Total tokens");
        assert_eq!(text(&r[0][10]), "Cost (USD)");

        // Detail row: sonnet-5 intro promo at 2026-07: 1M input @$2 + 1M output @$10 = $12.
        assert_eq!(text(&r[1][0]), "2026-07");
        assert_eq!(text(&r[1][1]), "Claude");
        assert_eq!(text(&r[1][2]), "claude-sonnet-5");
        assert_eq!(num(&r[1][8]), 2_000_000.0);
        assert_eq!(num(&r[1][9]), 2_000_000.0);
        assert!((num(&r[1][10]) - 12.0).abs() < 1e-9);

        // Total row closes the (month, provider) group.
        assert_eq!(text(&r[2][2]), "Total");
        assert_eq!(num(&r[2][9]), 2_000_000.0);
        assert!((num(&r[2][10]) - 12.0).abs() < 1e-9);
        assert_eq!(r.len(), 3);
    }

    #[test]
    fn direct_column_excludes_cache_and_the_total_row_sums_it() {
        let mut cached = rec("2026-07", ProviderId::Claude, "claude-sonnet-5", 100, 20);
        cached.cache_write_tokens = 300;
        cached.cache_read_tokens = 5_000;
        let h = aggregate(vec![cached], "2026-07".into(), 1_700_000_000);
        let mut wb = open(to_xlsx(&h).unwrap());
        let r = rows(&mut wb, "Usage");

        assert_eq!(num(&r[1][8]), 120.0);
        assert_eq!(num(&r[1][9]), 5_420.0);
        assert_eq!(num(&r[2][8]), 120.0);
    }

```

컬럼이 하나 늘었으므로 기존 테스트 3개의 인덱스도 함께 옮긴다. 아래가 전부다 —
`each_month_provider_group_gets_its_own_total`은 컬럼 0~2만 보므로 손대지 않는다.

`total_row_sums_every_model_in_the_group`의 마지막 두 단언:

```rust
        assert_eq!(num(&r[3][9]), 2_000_000.0);
        assert!((num(&r[3][10]) - 3.0).abs() < 1e-9);
```

`korean_sheet_mirrors_the_numbers_with_korean_labels`에서 비용 헤더 인덱스를 옮기고
direct 컬럼 라벨 단언을 추가한다:

```rust
        assert_eq!(text(&ko[0][0]), "연월");
        assert_eq!(text(&ko[0][2]), "모델");
        assert_eq!(text(&ko[0][8]), "직접 사용 토큰");
        assert_eq!(text(&ko[0][9]), "전체 토큰");
        assert_eq!(text(&ko[0][10]), "추정 비용($)");
        assert_eq!(text(&ko[2][2]), "합계");

        // Same shape, same numbers as the English sheet.
        assert_eq!(ko.len(), en.len());
        assert_eq!(num(&ko[1][8]), num(&en[1][8]));
        assert_eq!(num(&ko[2][10]), num(&en[2][10]));
```

`unknown_model_leaves_the_cost_cell_empty`의 비용 셀:

```rust
        assert!(r[1][10].is_empty(), "unpriced model must not claim a cost, got {:?}", r[1][10]);
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `cd src-tauri && cargo test --lib xlsx`
Expected: FAIL — `index out of bounds` 또는 `assertion failed: "Cost (USD)" == "Total tokens"` (아직 10컬럼)

- [ ] **Step 3: 헤더와 `token_cells`를 확장한다**

`src-tauri/src/xlsx.rs`:

```rust
struct Labels {
    sheet: &'static str,
    headers: [&'static str; 11],
    total: &'static str,
}

const EN: Labels = Labels {
    sheet: "Usage",
    headers: [
        "Month", "Provider", "Model", "Input tokens", "Output tokens",
        "Cache write", "Cache read", "Cached input", "Direct tokens",
        "Total tokens", "Cost (USD)",
    ],
    total: "Total",
};

const KO: Labels = Labels {
    sheet: "사용량",
    headers: [
        "연월", "서비스", "모델", "입력 토큰", "출력 토큰",
        "캐시 쓰기", "캐시 읽기", "캐시 입력", "직접 사용 토큰",
        "전체 토큰", "추정 비용($)",
    ],
    total: "합계",
};
```

`token_cells`를 교체한다. 원시 다섯 버킷은 감사 가능하도록 Codex도 로그 원본 값 그대로 나간다 — 정규화는 `direct_tokens` 컬럼에서만 일어난다.

```rust
/// The five raw token columns, the provider-normalized direct total, and the
/// grand total, in column order.
fn token_cells(d: &MonthlyDetail) -> [u64; 7] {
    [
        d.input_tokens, d.output_tokens, d.cache_write_tokens,
        d.cache_read_tokens, d.cached_input_tokens, d.direct_tokens, d.total_tokens,
    ]
}
```

- [ ] **Step 4: `write_sheet`의 컬럼 인덱스를 옮긴다**

`src-tauri/src/xlsx.rs`의 `write_sheet` 안에서 세 곳을 고친다.

detail 행의 비용 셀 (9 → 10):

```rust
            if let Some(cost) = d.cost_usd {
                sheet.write_number_with_format(row, 10, cost, &money)?;
            }
```

합계 행의 루프 상한 (6 → 7):

```rust
        for n in 0..7 {
            let sum: u64 = group.iter().map(|d| token_cells(d)[n]).sum();
            sheet.write_number_with_format(row, 3 + n as u16, sum as f64, &shaded_tokens)?;
        }
```

합계 행의 비용 셀 (9 → 10):

```rust
        sheet.write_number_with_format(row, 10, cost, &shaded_money)?;
```

- [ ] **Step 5: 테스트가 통과하는지 확인한다**

Run: `cd src-tauri && cargo test --lib`
Expected: PASS — 전부 통과

- [ ] **Step 6: 커밋**

```bash
git add src-tauri/src/xlsx.rs
git commit -m "feat(xlsx): 직접 사용 토큰 컬럼 추가 (#43)

원시 버킷 컬럼은 감사 가능하도록 로그 원본 값을 유지하고, 정규화된
합계는 새 Direct tokens 컬럼에만 넣는다.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: 요약 카드 — 직접 사용 대표 표시

**Files:**
- Modify: `src/lib/types.ts:37-44` (`MonthlySummary`), `:46-58` (`MonthlyDetail`)
- Modify: `src/components/UsageHistoryView.tsx:104-128` (카드), `:126` (`history-note`)
- Modify: `src/locales/ko.json`, `src/locales/en.json` (`history` 블록)
- Modify: `src/styles/theme.css:121` 근처
- Test: `src/components/UsageHistoryView.test.tsx`

**Interfaces:**
- Consumes: Task 1의 `MonthlySummary` 필드
- Produces: i18n 키 `history.withCache`, `history.cacheNote`; CSS 클래스 `.history-card-cached`; 테스트 픽스처 `HISTORY`가 신규 필드를 포함

- [ ] **Step 1: 타입을 맞춘다**

`src/lib/types.ts`의 `MonthlySummary`를 교체:

```ts
export interface MonthlySummary {
  year_month: string;
  provider: "claude" | "codex";
  /**
   * Display-normalized buckets — these four always sum to `total_tokens`.
   * For Codex, `input_tokens` has its cached reads stripped out and
   * `cache_read_tokens` comes from the raw `cached_input_tokens`.
   */
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  /** `input_tokens + output_tokens` — the headline number. */
  direct_tokens: number;
  total_tokens: number;
  cost_usd: number | null;
  cost_estimable: boolean;
}
```

`MonthlyDetail`에는 `cached_input_tokens` 다음에 한 줄 추가:

```ts
  direct_tokens: number;
```

- [ ] **Step 2: i18n 키를 추가한다**

`src/locales/ko.json`의 `history` 블록에서 `colTokens` 값을 바꾸고 키를 추가한다:

```json
    "withCache": "캐시 포함 {{total}}",
    "cacheNote": "직접 사용 = 입력 + 출력. 캐시 읽기는 대화 컨텍스트를 매 턴 다시 참조하며 쌓이는 값이라 대화가 길어질수록 커져요",
    "bucketInput": "입력",
    "bucketOutput": "출력",
    "bucketCacheRead": "캐시 읽기",
    "bucketCacheWrite": "캐시 쓰기",
    "bucketTotal": "총합",
    "expandRow": "상세 보기",
    "colTokens": "직접 사용 토큰",
```

`src/locales/en.json`의 같은 블록:

```json
    "withCache": "{{total}} incl. cache",
    "cacheNote": "Direct use = input + output. Cache reads pile up because every turn re-reads the conversation context, so they grow with conversation length",
    "bucketInput": "Input",
    "bucketOutput": "Output",
    "bucketCacheRead": "Cache read",
    "bucketCacheWrite": "Cache write",
    "bucketTotal": "Total",
    "expandRow": "Show breakdown",
    "colTokens": "Direct tokens",
```

기존 `colTokens` 줄은 지우고 위 값으로 대체한다 (JSON에 중복 키를 남기지 말 것).

- [ ] **Step 3: 실패하는 테스트를 쓴다**

`src/components/UsageHistoryView.test.tsx`의 `HISTORY` 상수를 교체하고, `describe` 블록 안에 테스트 2개를 추가한다.

```tsx
const HISTORY = {
  current_month: "2026-07",
  scanned_at: 1784192400,
  summaries: [
    {
      year_month: "2026-07", provider: "claude",
      input_tokens: 1_000_000, output_tokens: 234_567,
      cache_read_tokens: 9_000_000, cache_write_tokens: 500_000,
      direct_tokens: 1_234_567, total_tokens: 10_734_567,
      cost_usd: 12.34, cost_estimable: true,
    },
    {
      year_month: "2026-07", provider: "codex",
      input_tokens: 7_000_000, output_tokens: 654_321,
      cache_read_tokens: 0, cache_write_tokens: 0,
      direct_tokens: 7_654_321, total_tokens: 7_654_321,
      cost_usd: 5.5, cost_estimable: true,
    },
  ],
  details: [],
};
```

```tsx
  it("leads with direct tokens and keeps the cache-inclusive total as a subline", async () => {
    getUsageHistory.mockResolvedValue(HISTORY);
    render(<UsageHistoryView />);
    // The headline is what the user spent, not the cache-dominated total.
    expect(await screen.findByText(/1,234,567/)).toBeTruthy();
    expect(screen.getByText(/10,734,567 incl\. cache/)).toBeTruthy();
  });

  it("omits the cache subline when a provider has no cache traffic", async () => {
    getUsageHistory.mockResolvedValue(HISTORY);
    render(<UsageHistoryView />);
    await screen.findByText(/1,234,567/);
    // Codex here has total === direct; repeating the number would just be noise.
    expect(screen.queryByText(/7,654,321 incl\. cache/)).toBeNull();
  });
```

- [ ] **Step 4: 테스트가 실패하는지 확인한다**

Run: `npm test -- src/components/UsageHistoryView.test.tsx`
Expected: FAIL — `Unable to find an element with the text: /10,734,567 incl. cache/` (카드가 아직 total만 렌더)

- [ ] **Step 5: 카드를 구현한다**

`src/components/UsageHistoryView.tsx`의 카드 `<div>` 안 `history-card-tokens` 블록을 교체한다:

```tsx
                <span className="history-card-tokens">
                  {formatTokens(s?.direct_tokens ?? 0)} {t("history.tokens")}
                </span>
                {s && s.total_tokens > s.direct_tokens && (
                  <span className="history-card-cached">
                    {t("history.withCache", { total: formatTokens(s.total_tokens) })}
                  </span>
                )}
```

`history-note` 문단 바로 아래에 한 줄 추가한다:

```tsx
      <p className="history-note">{t("history.estimateNote")}</p>
      <p className="history-note">{t("history.cacheNote")}</p>
```

- [ ] **Step 6: CSS를 추가한다**

`src/styles/theme.css`의 `.history-card-tokens` 규칙 바로 아래에 삽입:

```css
.history-card-cached { font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
```

- [ ] **Step 7: 테스트가 통과하는지 확인한다**

Run: `npm test -- src/components/UsageHistoryView.test.tsx && npm run build`
Expected: PASS — 테스트 전부 통과, `tsc`도 에러 없음

- [ ] **Step 8: 커밋**

```bash
git add src/lib/types.ts src/components/UsageHistoryView.tsx src/components/UsageHistoryView.test.tsx src/locales/ko.json src/locales/en.json src/styles/theme.css
git commit -m "feat(history): 요약 카드 대표 수치를 직접 사용으로 전환 (#43)

캐시 포함 총합은 보조 줄로 내리고, 캐시가 0인 프로바이더에서는
같은 숫자가 두 번 뜨지 않도록 조건부로 렌더한다.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: 월별 테이블 확장 행

**Files:**
- Modify: `src/components/UsageHistoryView.tsx` (테이블 `<tbody>` 및 상단 `useState` 선언부)
- Modify: `src/styles/theme.css` (`.history-warn` 규칙 앞)
- Test: `src/components/UsageHistoryView.test.tsx`

**Interfaces:**
- Consumes: Task 1의 `MonthlySummary` 버킷 필드, Task 3의 `history.bucket*` / `history.expandRow` i18n 키
- Produces: 없음 (최종 UI)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/components/UsageHistoryView.test.tsx`에 추가:

```tsx
  it("hides the bucket breakdown until the row is expanded", async () => {
    getUsageHistory.mockResolvedValue(HISTORY);
    render(<UsageHistoryView />);
    await screen.findByText(/1,234,567/);
    expect(screen.queryByText("Cache read")).toBeNull();

    const toggles = screen.getAllByRole("button", { name: "Show breakdown" });
    expect(toggles[0].getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggles[0]);

    expect(toggles[0].getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Cache read")).toBeTruthy();
    expect(screen.getByText("9,000,000")).toBeTruthy();
  });

  it("leaves empty buckets out of the breakdown", async () => {
    getUsageHistory.mockResolvedValue(HISTORY);
    render(<UsageHistoryView />);
    await screen.findByText(/1,234,567/);
    // Second row is Codex, whose cache buckets are both zero.
    const toggles = screen.getAllByRole("button", { name: "Show breakdown" });
    fireEvent.click(toggles[1]);
    expect(screen.queryByText("Cache write")).toBeNull();
    expect(screen.getByText("Input")).toBeTruthy();
  });
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npm test -- src/components/UsageHistoryView.test.tsx`
Expected: FAIL — `Unable to find an accessible element with the role "button" and name "Show breakdown"`

- [ ] **Step 3: 확장 상태를 컴포넌트에 추가한다**

`src/components/UsageHistoryView.tsx`의 다른 `useState` 선언들 바로 아래에 추가:

```tsx
  // Keyed by `${year_month}-${provider}` so the open set survives a refresh
  // that replaces the summary objects.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleRow = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
```

- [ ] **Step 4: 테이블 본문을 교체한다**

`src/components/UsageHistoryView.tsx`의 `<tbody>` 블록 전체를 교체한다. 토글은 `<tr>`이 아니라 셀 안의 `<button>`이 담당한다 — 행 전체 `onClick`은 키보드로 도달할 수 없다.

```tsx
        <tbody>
          {history.summaries.map((s) => {
            const key = `${s.year_month}-${s.provider}`;
            const open = expanded.has(key);
            const buckets: Array<[string, number]> = [
              ["bucketInput", s.input_tokens],
              ["bucketOutput", s.output_tokens],
              ["bucketCacheRead", s.cache_read_tokens],
              ["bucketCacheWrite", s.cache_write_tokens],
              ["bucketTotal", s.total_tokens],
            ];
            return (
              <Fragment key={key}>
                <tr>
                  <td>
                    <button
                      type="button"
                      className="history-expand"
                      aria-expanded={open}
                      aria-label={t("history.expandRow")}
                      onClick={() => toggleRow(key)}
                    >
                      <span aria-hidden="true">{open ? "▾" : "▸"}</span> {s.year_month}
                    </button>
                  </td>
                  <td style={{ color: ACCENT[s.provider] }}>{t(`provider.${s.provider}`)}</td>
                  <td>{formatTokens(s.direct_tokens)}</td>
                  <td>
                    {formatUsd(s.cost_usd)}
                    {!s.cost_estimable && <span className="history-warn" title={t("history.notEstimable")}> ≈</span>}
                  </td>
                </tr>
                {open && (
                  <tr className="history-breakdown-row">
                    <td colSpan={4}>
                      <dl className="history-breakdown">
                        {buckets
                          .filter(([, value]) => value > 0)
                          .map(([label, value]) => (
                            <div key={label}>
                              <dt>{t(`history.${label}`)}</dt>
                              <dd>{formatTokens(value)}</dd>
                            </div>
                          ))}
                      </dl>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
```

파일 최상단의 React import에 `Fragment`를 추가한다:

```tsx
import { Fragment, useEffect, useRef, useState } from "react";
```

- [ ] **Step 5: CSS를 추가한다**

`src/styles/theme.css`의 `.history-warn` 규칙 **바로 앞**에 삽입한다. 확장 행은 `colSpan`으로 4칸을 차지하므로 `nth-child(3)/(4)` 우측 정렬 규칙과 충돌하지 않는다.

```css
.history-expand {
  background: none;
  border: 0;
  padding: 0;
  font: inherit;
  color: inherit;
  cursor: pointer;
  font-variant-numeric: tabular-nums;
}
.history-breakdown-row td { padding: 2px 8px 8px 20px; }
.history-breakdown { display: flex; flex-wrap: wrap; gap: 4px 16px; margin: 0; }
.history-breakdown > div { display: flex; gap: 6px; }
.history-breakdown dt { color: var(--muted); font-size: 12px; }
.history-breakdown dd { margin: 0; font-size: 12px; font-variant-numeric: tabular-nums; }
```

- [ ] **Step 6: 테스트가 통과하는지 확인한다**

Run: `npm test && npm run build`
Expected: PASS — 프런트 테스트 전부 통과 (`App.test.tsx` 포함), `tsc` 에러 없음

- [ ] **Step 7: 커밋**

```bash
git add src/components/UsageHistoryView.tsx src/components/UsageHistoryView.test.tsx src/styles/theme.css
git commit -m "feat(history): 월별 행에 캐시 버킷 확장 표시 (#43)

토큰 컬럼을 직접 사용 기준으로 바꾸고, 월 셀의 버튼으로 입력·출력·
캐시 읽기·쓰기 분해를 펼친다. 값이 0인 버킷은 표시하지 않는다.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: 프로바이더 회계 차이 문서화

**Files:**
- Modify: `src-tauri/src/history.rs` (`display_buckets` doc comment — Task 1에서 이미 작성됨, 확인만)
- Modify: `README.md` (사용 이력 설명 섹션)

**Interfaces:**
- Consumes: Task 1~4 전부
- Produces: 없음 (최종 태스크)

- [ ] **Step 1: 토큰 회계 설명을 추가한다**

`README.md`의 `## 화면` 섹션이 끝나는 지점 — "> 위 이미지는 데모용 예시 데이터로…" 인용
블록 다음, `## 다운로드 및 설치` 헤딩 **바로 앞**에 아래 섹션을 삽입한다.

```markdown
## 토큰 집계 방식

화면의 대표 수치는 **직접 사용**(입력 + 출력)입니다. 캐시 읽기는 대화 컨텍스트를 매 턴
다시 참조하며 쌓이는 값이라 실측에서 전체의 90%를 넘기는 일이 흔하고, 그대로 합산하면
체감 사용량과 크게 어긋납니다. 캐시 포함 총합은 카드의 보조 줄과 월별 행 확장에서 볼 수
있고, Excel 내보내기에는 버킷별 원본 값이 모두 들어갑니다.

두 서비스는 로그의 회계 방식이 다릅니다. Claude는 캐시 읽기를 별도 필드로 보고하지만,
Codex는 `input`에 캐시 읽기를 포함시키고 그중 캐시분을 `cached_input`으로 따로 표시합니다.
앱은 Codex의 `input`에서 `cached_input`을 빼서 두 서비스의 "직접 사용"이 같은 것을 뜻하도록
맞춥니다. Excel의 원시 버킷 컬럼은 대조가 가능하도록 로그 원본 값을 그대로 유지합니다.
```

- [ ] **Step 2: 전체 검증**

Run: `cd src-tauri && cargo test --lib && cd .. && npm test && npm run build`
Expected: PASS — Rust·프런트 테스트 전부 통과, 타입체크 통과

- [ ] **Step 3: 커밋**

```bash
git add README.md
git commit -m "docs(readme): 토큰 집계 방식과 프로바이더 회계 차이 설명 (#43)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## 검증 체크리스트

구현 완료 후 실제 앱에서 확인할 것 (자동 테스트로는 못 잡는 것들):

- [ ] 카드 보조 줄이 카드 높이를 늘려 `HistorySkeleton`과 어긋나지 않는지 — 어긋나면 `src/components/HistorySkeleton.tsx`에 `history-skeleton__card-cached` 자리를 추가한다 (`theme.css:185` 주석이 이 문제의 전례를 설명한다)
- [ ] 좁은 창에서 확장 행의 `.history-breakdown`이 줄바꿈되며 가로 스크롤을 만들지 않는지
- [ ] 다크/라이트 테마 양쪽에서 `.history-card-cached`의 `var(--muted)` 대비가 읽히는지
- [ ] Excel을 열어 `직접 사용 토큰` 컬럼이 `전체 토큰` 왼쪽에 있고 합계 행이 채워지는지
