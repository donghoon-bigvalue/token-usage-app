# 월별 토큰 사용량 & 비용 추정 — 설계 문서

- **날짜:** 2026-07-14
- **이슈:** [donghoon-bigvalue/token-usage-app#19](https://github.com/donghoon-bigvalue/token-usage-app/issues/19)
- **상태:** 승인됨 (설계 확정, 사용자 확인 완료)

## 1. 목적

로컬에 쌓인 Claude Code / Codex 사용 기록을 기반으로 **월별 토큰 사용량과 추정 비용(달러)** 을 앱 안에서 확인하고, 표로 정리한 **CSV를 다운로드**할 수 있게 한다.

이슈 요구사항:

- 로컬 환경의 사용 기록을 기반으로 월별 token 사용량 추정
- Claude와 Codex 사용량을 함께 확인
- 이번 달 토큰 사용량 + 비용($)을 앱 내에서 확인 (Claude / Codex 별도)
- 연월별 토큰·비용을 표로 정리한 CSV를 다운로드 버튼으로 내려받기

## 2. 확정된 결정사항

| 항목 | 결정 |
| --- | --- |
| 비용 계산 방식 | **API 요금 환산 추정** — 모델별 공개 API 단가표를 앱에 내장, 로컬 로그의 실제 토큰 수 × 단가. 구독제 실제 청구액과는 무관한 추정치임을 UI에 명시 |
| UI 배치 | **별도 탭/뷰** — Header에 "한도" ↔ "사용 이력" 토글. 기존 한도 화면은 그대로 유지 |
| 집계 수준 | **요약 + 상세 둘 다** — 화면 표는 (연월 × 서비스) 요약, CSV는 (연월 × 서비스 × 모델) 상세 행까지 포함 |
| 집계 위치 | **Rust 백엔드** — 파싱·집계·비용계산 전부 Rust. 프런트는 표시 + CSV 저장 다이얼로그만 |

## 3. 데이터 소스 (로컬 로그 포맷)

### 3.1 Claude Code — `~/.claude/projects/**/*.jsonl`

세션 트랜스크립트. `type == "assistant"` 라인에서 추출:

- `timestamp` — ISO8601 (예: `2026-07-08T06:09:03.964Z`) → 월 버킷 키
- `message.model` — 예: `claude-sonnet-5`, `claude-opus-4-8`, `claude-haiku-4-5`, `claude-fable-5`
- `message.usage`:
  - `input_tokens` — **캐시 제외** 순수 입력
  - `output_tokens`
  - `cache_creation_input_tokens` — 캐시 쓰기 (별도 필드)
  - `cache_read_input_tokens` — 캐시 읽기 (별도 필드)

> Claude는 4개 필드가 **서로 배타적**. `input_tokens`에 캐시가 포함되지 않는다.

### 3.2 Codex — `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`

- `type == "turn_context"` 라인의 `payload.model` — 예: `gpt-5.5`, `gpt-5.3-codex` — 턴마다 바뀔 수 있음. 각 turn_context는 이후 이벤트들의 "현재 모델"이 된다.
- `type == "event_msg"` 且 `payload.type == "token_count"` 라인의 `payload.info`:
  - `last_token_usage` — **직전 턴 델타** (이걸 합산). 필드: `input_tokens`, `cached_input_tokens`, `output_tokens`, `reasoning_output_tokens`, `total_tokens`
  - `total_token_usage` — 세션 누적 (검증용, 합산에는 안 씀)

> Codex는 `input_tokens`가 `cached_input_tokens`를 **포함**한다. 순수 입력 = `input_tokens − cached_input_tokens`. `reasoning_output_tokens`는 output 요금으로 과금(별도 표기 불필요, output에 포함 처리).
>
> **월 귀속:** 각 `token_count` 이벤트의 `timestamp` 월에 `last_token_usage` 델타를 귀속. 모델은 그 이벤트 직전의 마지막 `turn_context.payload.model`. 이렇게 하면 세션이 월 경계를 넘어도 자연스럽게 처리된다.

## 4. 비용 계산 규칙

단가는 `pricing.rs`에 **MTok(백만 토큰)당 USD**로 내장한다. 공개 API 요금 기준의 편집 가능한 추정치이며, UI에 "추정치" 명시.

- **Claude:** `input×in_rate + output×out_rate + cache_creation×cache_write_rate + cache_read×cache_read_rate`
  - 관례적 캐시 단가: write ≈ input×1.25 (5m) , read ≈ input×0.1. (모델별 테이블에 명시)
- **Codex:** `(input − cached)×in_rate + cached×cached_in_rate + output×out_rate`

미등록 모델은 토큰은 집계하되 **비용 = null** + "추정 불가" 플래그. 화면/CSV에서 구분 표기.

> 정확한 단가 수치는 구현 단계에서 `pricing.rs`에 표로 확정한다. 알려진 모델(Opus/Sonnet/Haiku/Fable, GPT-5.x/Codex 계열)에 대해 공개 요금 기반 값을 채우고, 값 출처를 주석으로 남긴다.

## 5. 컴포넌트 구조

### 5.1 백엔드 (Rust, `src-tauri/src/`)

- **`pricing.rs`** (신규): `model_id → ModelPricing { in, cached_in, out, cache_write, cache_read }` 조회. 미등록 시 `None`.
- **`history.rs`** (신규): 월별 집계 오케스트레이터.
  - `providers::claude::scan_usage(home) -> Vec<UsageRecord>` (신규 함수): projects JSONL 순회, assistant usage 수집
  - `providers::codex::scan_usage(home) -> Vec<UsageRecord>` (신규 함수): 롤아웃 순회, token_count 델타 + turn_context 모델
  - 집계: `Vec<UsageRecord>` → `Vec<MonthlyDetail>` (연월×서비스×모델) → `Vec<MonthlySummary>` (연월×서비스)
  - 비용 계산은 `pricing.rs` 참조
- **타입** (`model.rs`에 추가):
  - `UsageRecord { year_month, provider, model, input, output, cache_write, cache_read, cached_input }` (서비스별 의미 차이는 집계 전 정규화)
  - `MonthlyDetail { year_month, provider, model, input_tokens, output_tokens, cache_tokens, total_tokens, cost_usd: Option<f64>, cost_estimable: bool }`
  - `MonthlySummary { year_month, provider, total_tokens, cost_usd: Option<f64>, cost_estimable: bool }`
  - `UsageHistory { summaries: Vec<MonthlySummary>, details: Vec<MonthlyDetail>, current_month: { claude: MonthlySummary, codex: MonthlySummary } }`
- **Tauri commands** (`commands.rs`에 추가):
  - `get_usage_history() -> Result<UsageHistory, String>`
  - `export_usage_csv(path: String) -> Result<(), String>` — 상세 행 CSV를 지정 경로에 저장

### 5.2 프런트 (React, `src/`)

- **Header** (`components/Header.tsx`): 뷰 토글 추가 ("한도" / "사용 이력")
- **`components/UsageHistoryView.tsx`** (신규):
  - **이번 달 요약 카드** 2개 (Claude `#D97757` / Codex `#5162ED`): 이번 달 총 토큰 + 추정 비용($). 비용 추정 불가 모델 포함 시 "≈" / 안내 표기
  - **월별 표**: 행 = (연월 × 서비스) 요약, 최신 월 위로 정렬. 컬럼: 연월 / 서비스 / 토큰 / 추정 비용
  - **CSV 다운로드 버튼**: `@tauri-apps/plugin-dialog` save dialog → `export_usage_csv(path)` 호출
  - 로딩/빈 상태/에러 처리 (기존 `EmptyState` 재사용)
- **`lib/types.ts`**: `MonthlySummary`, `MonthlyDetail`, `UsageHistory` 타입 추가
- **`lib/usage.ts`** 또는 신규 `lib/history.ts`: `get_usage_history` invoke 래퍼
- **i18n**: `src/locales/{ko,en}.json`에 `history.*` 키 추가 (탭 라벨, 표 헤더, 이번 달, 추정치 안내, 다운로드, 빈 상태 등)

## 6. 데이터 흐름

```
"사용 이력" 탭 열림
  → get_usage_history() 호출 (로딩 상태)
  → Rust: ~/.claude/projects/**/*.jsonl + ~/.codex/sessions/**/*.jsonl 스캔
  → UsageRecord 수집 → 월 버킷 집계 → pricing.rs로 비용 계산
  → UsageHistory 반환
  → 요약 카드 + 월별 표 렌더
CSV 버튼 → save dialog로 경로 선택 → export_usage_csv(path) → 파일 저장
```

- 결과는 **앱 세션 동안 메모리 캐시** + 수동 새로고침 버튼. 파일 mtime 기반 증분 캐시는 후속 개선(범위 밖).

## 7. 엣지 케이스 & 에러 처리

- 로컬 로그 디렉터리 없음 / 기록 없음 → 빈 상태 UI ("사용 기록 없음")
- 깨진 JSONL 라인 → 스킵 (기존 Codex 파서의 `filter_map` 패턴 준수)
- `usage`/`token_count` 없는 라인 → 스킵
- 미등록 모델 → 토큰 집계 O, 비용 null + "추정 불가" 표기
- 비용은 "구독제와 무관한 API 환산 추정치"임을 화면에 명시
- 대량 파일 스캔 지연 → 로딩 인디케이터. (성능 최적화는 후속)

## 8. 테스트 전략

- **Rust 단위 테스트** (`tests/fixtures` 패턴):
  - Claude scan: 샘플 projects JSONL → 올바른 월·모델·토큰 집계
  - Codex scan: 샘플 롤아웃 → `last_token_usage` 델타 합산 + turn_context 모델 귀속 + 월 경계
  - pricing: 알려진 모델 비용 계산, 미등록 모델 null
  - CSV: 상세 행 → 기대 CSV 문자열
- **프런트 (vitest)**:
  - `UsageHistoryView` 표 렌더 (요약 데이터 목)
  - 빈 상태 렌더
  - CSV 버튼 → command invoke 호출 확인 (모킹)
  - i18n 키 존재 확인

## 9. 범위 밖 (YAGNI)

- 파일 mtime 기반 증분 캐시 / 백그라운드 프리페치
- 사용량 그래프/차트 (표만)
- 실제 청구액 연동, 결제 API
- 일별/시간별 세분화 (월 단위까지만)
- 단가 사용자 편집 UI (코드 내장값만; 후속 이슈 후보)
