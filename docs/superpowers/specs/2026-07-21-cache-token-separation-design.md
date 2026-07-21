# 캐시 토큰 분리 표시 설계 (issue #43)

## 문제

사용 이력 화면의 "총 토큰"은 `input + output + cache_write + cache_read`의 단순 합이다
(`src-tauri/src/history.rs:36`). 비중첩 필드 합산이라 수치 자체는 틀리지 않지만, 실측에서
`cache_read`가 전체의 94.2%를 차지해 화면에 "21.5억 토큰"이 뜬다. 사용자가 자기 사용량으로
인식하는 `input + output`은 933만(0.4%)이다.

캐시 읽기는 대화 컨텍스트를 매 턴 재참조하며 누적되는 값이라 턴 수에 비례해 폭증한다.
숫자는 맞지만 사용자 체감과 괴리되어 "과다 집계" 인상에 기여한다.

추가로 Claude와 Codex의 "총 토큰" 정의가 이미 다르다. Codex는 `input`이 cached를 포함하는
회계라 `input + output`만 더한다(`history.rs:42`). 프로바이더 간 수치가 서로 비교 불가능하다.

## 목표

1. 대표 수치를 사용자 체감과 일치시킨다.
2. 캐시 비중을 숨기지 않고 접근 가능한 위치에 분리 표시한다.
3. Claude/Codex 간 "직접 사용"의 의미를 통일해 비교 가능하게 만든다.

## 비목표

- 중복 레코드로 인한 과다 집계 수정 (#42, 별개 이슈)
- 비용 계산 변경 — `cost_usd`는 이미 버킷별 단가를 정확히 적용하므로 이 이슈의 영향 밖
- `total_tokens`의 정의나 값 변경 — 그대로 유지한다

## 핵심 결정

### 결정 1: `direct_tokens`를 추가하고 `total_tokens`는 유지

`total_tokens`의 의미를 바꾸는 대신 새 필드를 추가한다. 기존 값에 의존하는 코드(xlsx 합계
행, 테스트)가 그대로 동작하므로 회귀 위험이 없고, 화면에서는 어느 쪽을 크게 보여줄지만
고르면 된다.

### 결정 2: 버킷 회계는 백엔드에서 한다

"Codex는 cached를 빼야 한다" 같은 프로바이더별 회계 규칙은 이미 `history.rs`에 사는 관심사다
(`claude_cost` / `codex_cost` 분기와 같은 위치). 프런트에서 `details`를 재집계하면 같은 규칙이
TypeScript와 Rust 두 곳에 중복되고, xlsx 내보내기는 어차피 Rust 쪽 계산이 필요하다.
백엔드에서 계산해 내려준다.

### 결정 3: Codex 직접 사용은 cached를 차감한다

Codex의 `input_tokens`는 캐시 읽기를 포함한다. `input + output`을 그대로 쓰면 이름만 통일되고
의미는 Claude와 다르다. `input − cached_input + output`으로 캐시를 벗겨내야 두 프로바이더의
"직접 사용"이 같은 것을 뜻한다.

## 설계

### 1. 데이터 모델 (`src-tauri/src/model.rs`)

`MonthlyDetail`에 필드 1개 추가:

```rust
pub direct_tokens: u64,
```

`MonthlySummary`에 필드 3개 추가:

```rust
pub direct_tokens: u64,
pub cache_read_tokens: u64,
pub cache_write_tokens: u64,
```

`MonthlySummary`의 캐시 필드는 **표시용으로 정규화된 값**이다 (아래 표 참조). 원시 버킷 이름과
같지만 Codex에서는 다른 원본 필드에서 온다 — 이 점을 필드 doc comment에 명시한다.

### 2. 집계 규칙 (`src-tauri/src/history.rs`)

`aggregate()`의 기존 프로바이더 분기 안에서 함께 계산한다:

| 값 | Claude | Codex |
|---|---|---|
| `direct_tokens` | `input + output` | `input.saturating_sub(cached_input) + output` |
| 표시용 `cache_read_tokens` | `cache_read_tokens` | `cached_input_tokens` |
| 표시용 `cache_write_tokens` | `cache_write_tokens` | `0` (Codex는 캐시 쓰기 개념 없음) |
| `total_tokens` | `input + output + cache_write + cache_read` (변경 없음) | `input + output` (변경 없음) |

`saturating_sub`는 로그 이상치로 `cached_input > input`인 레코드가 왔을 때의 언더플로 패닉을
막는다. u64 언더플로는 디버그 빌드에서 패닉, 릴리스에서 거대한 쓰레기 값이 되므로 방어가 필요하다.

요약 합산 루프(`sums`)는 튜플 대신 작은 구조체로 바꿔 4개 값(`total`, `direct`, `cache_read`,
`cache_write`)과 비용을 누적한다. 튜플 원소가 5개가 되면 `e.0`, `e.3` 같은 인덱스 접근이
읽히지 않는다.

### 3. 요약 카드 (`src/components/UsageHistoryView.tsx`)

```
┌─ Claude ─────────────┐
│ 9.34M 토큰           │  ← direct_tokens, 기존 .history-card-tokens 스타일
│ 캐시 포함 2.15B      │  ← total_tokens, 작고 흐리게 (신규 .history-card-cached)
│ $123.45              │  ← 변경 없음
└──────────────────────┘
```

캐시 보조 줄은 `total_tokens > direct_tokens`일 때만 렌더한다. Codex처럼 캐시가 0인 경우
"캐시 포함"이 같은 숫자로 중복 표시되는 것을 막는다.

### 4. 월별 테이블 확장 행

토큰 컬럼 값을 `total_tokens` → `direct_tokens`로 바꾸고, 각 월 행을 클릭하면 버킷 분해가
펼쳐진다.

- 확장 상태는 `useState<Set<string>>`로 `${year_month}-${provider}` 키를 관리한다.
- 접근성: 월 셀 안의 `<button>`이 토글을 담당하고 `aria-expanded`를 갖는다. 행 전체에
  `onClick`을 거는 방식은 키보드 접근이 불가능하므로 쓰지 않는다.
- 펼친 내용은 `colSpan`을 쓴 단일 하위 행 안의 정의 목록(입력 / 출력 / 캐시 읽기 /
  캐시 쓰기 / 총합). 컬럼 수가 늘지 않아 좁은 창에서도 레이아웃이 깨지지 않는다.
- 값이 0인 버킷은 표시하지 않는다 (Codex의 캐시 쓰기 등).

### 5. 프로바이더 차이 안내

기존 `history.estimateNote` 아래에 한 줄 추가:

> 직접 사용 = 입력 + 출력. 캐시 읽기는 대화 컨텍스트를 매 턴 다시 참조하며 쌓이는 값이라
> 대화가 길어질수록 커져요.

Codex의 회계 차이(`input`이 cached 포함)는 `history.rs`의 계산 지점 주석과 README의 사용 이력
설명에 명시한다. UI에서 별도 프로바이더별 각주를 달지는 않는다 — 정의를 통일했으므로
사용자에게는 차이가 보이지 않아야 한다.

### 6. i18n (`src/locales/{ko,en}.json`)

`history` 아래 신규 키:

| 키 | ko | en |
|---|---|---|
| `directTokens` | 직접 사용 | Direct use |
| `withCache` | 캐시 포함 {{total}} | {{total}} incl. cache |
| `bucketInput` | 입력 | Input |
| `bucketOutput` | 출력 | Output |
| `bucketCacheRead` | 캐시 읽기 | Cache read |
| `bucketCacheWrite` | 캐시 쓰기 | Cache write |
| `bucketTotal` | 총합 | Total |
| `cacheNote` | (위 안내 문구) | (영문 대응) |
| `expandRow` | 상세 보기 | Show breakdown |

`colTokens`의 값은 "토큰" → "직접 사용 토큰" / "Direct tokens"로 바꿔 컬럼이 무엇을 뜻하는지
헤더만 봐도 알 수 있게 한다.

### 7. xlsx 내보내기 (`src-tauri/src/xlsx.rs`)

이미 5개 원시 버킷 컬럼을 모두 내보내고 있으므로 컬럼 1개만 추가한다.

- `Labels.headers`를 `[&'static str; 10]` → `[&'static str; 11]`로 확장
- `Total tokens` / `전체 토큰` **앞에** `Direct tokens` / `직접 사용 토큰` 삽입 (인덱스 8)
- `token_cells()` 반환 타입을 `[u64; 6]` → `[u64; 7]`로 확장하고 `direct_tokens` 포함
- 비용 셀 컬럼 인덱스 9 → 10

xlsx의 원시 버킷 컬럼은 Codex도 원본 값 그대로 유지한다 (감사 가능성). 정규화는
`Direct tokens` 컬럼에서만 일어난다.

## 테스트

### Rust (`history.rs`)

- Claude: `direct_tokens == input + output`, 표시용 캐시 필드가 원시 버킷과 일치
- Codex: `direct_tokens == input − cached_input + output`, 표시용 `cache_read == cached_input`,
  `cache_write == 0`
- Codex 이상치: `cached_input > input`일 때 패닉 없이 `direct_tokens`가 `output`으로 수렴
- 요약: 여러 모델의 detail이 (월×프로바이더) 요약에서 버킷별로 올바르게 합산
- 기존 `total_tokens` 테스트가 값 변경 없이 통과 (회귀 가드)

### Rust (`xlsx.rs`)

- 기존 헤더 테스트를 11컬럼으로 갱신, `Direct tokens` 위치 검증
- 합계 행이 direct 컬럼도 합산하는지 검증

### 프런트 (`UsageHistoryView`)

- 카드가 `direct_tokens`를 대표 수치로, `total_tokens`를 보조로 렌더
- 캐시가 0인 프로바이더에서 보조 줄이 나오지 않음
- 테이블 토큰 컬럼이 `direct_tokens`를 표시
- 확장 버튼 클릭 시 버킷 행이 나타나고 `aria-expanded`가 토글됨
- 값이 0인 버킷은 확장 행에 나타나지 않음

## 영향받는 파일

| 파일 | 변경 |
|---|---|
| `src-tauri/src/model.rs` | `MonthlyDetail` +1, `MonthlySummary` +3 필드 |
| `src-tauri/src/history.rs` | 프로바이더 분기에서 direct/캐시 계산, 요약 누적 구조체화 |
| `src-tauri/src/xlsx.rs` | 컬럼 10 → 11 |
| `src/lib/types.ts` | 대응 필드 추가 |
| `src/components/UsageHistoryView.tsx` | 카드 2단 표시, 테이블 확장 행 |
| `src/locales/{ko,en}.json` | 신규 키 9개, `colTokens` 문구 변경 |
| `src/styles/theme.css` | `.history-card-cached`, 확장 행 스타일 |
| `README.md` | 사용 이력 설명에 직접 사용/캐시 구분 및 Codex 회계 차이 |
