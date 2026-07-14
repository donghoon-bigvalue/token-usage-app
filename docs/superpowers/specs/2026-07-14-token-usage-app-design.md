# Token Usage App — 설계 문서

- **날짜:** 2026-07-14
- **이슈:** [donghoon-bigvalue/token-usage-app#1](https://github.com/donghoon-bigvalue/token-usage-app/issues/1)
- **상태:** 승인됨 (사용자 확인 완료)

## 1. 목적

Claude와 Codex를 구독제로 사용하는 사람을 위해, 두 서비스의 토큰/사용량 한도와 리셋 시각을 **막대 바 기반으로 예쁘게** 보여주는 Tauri 기반 데스크톱 앱을 만든다.

이슈 요구사항:

**Claude** (강조색 `#D97757`)
- 어떤 구독제를 쓰는지
- Current session (리셋 시각 포함)
- Current week — all models (리셋 시각 포함)
- Current week — Fable (리셋 시각 포함)

**Codex** (강조색 `#5162ED`)
- 어떤 구독제를 쓰는지
- Weekly limit (리셋 시각 포함)
- GPT-5.3-Codex-Spark Weekly limit (리셋 시각 포함)
- (보너스) Current 5-hour window (리셋 시각 포함) — 데이터가 있으므로 함께 표시

**공통**
- Dark Mode / Light Mode 지원
- 메인 언어는 영어, 한국어 지원 포함

## 2. 확정된 결정사항

| 항목 | 결정 |
|------|------|
| 프론트엔드 스택 | React + TypeScript + Vite |
| Codex 데이터 소스 | 라이브 엔드포인트 우선, 로컬 rollout 파일 폴백 |
| 폼 팩터 | 대시보드 창 + 시스템 트레이, 자동 새로고침 |
| MVP 범위 | 한도 임박 알림 + 수동/자동 새로고침 + 인앱 언어/테마 토글 (전부 포함) |
| Codex 5시간 윈도우 | 보너스로 표시 |

## 3. 데이터 소스 (검증됨)

### 3.1 Claude — 라이브 검증 완료 ✅

- 자격증명: `~/.claude/.credentials.json` → `claudeAiOauth.accessToken`, `subscriptionType`, `rateLimitTier`.
- 요청: `GET https://api.anthropic.com/api/oauth/usage`
  - 헤더: `Authorization: Bearer <accessToken>`, `anthropic-beta: oauth-2025-04-20`
- 응답에서 사용하는 필드 (실제 캡처):
  - `five_hour` → `{ utilization, resets_at }` = **Current session**
  - `seven_day` → `{ utilization, resets_at }` = **Current week (all models)**
  - `limits[]` 중 `kind == "weekly_scoped"` 이고 `scope.model.display_name == "Fable"` → `{ percent, resets_at }` = **Current week (Fable)**
  - `subscriptionType` (예: `max`), `rateLimitTier` (예: `default_claude_max_20x`) → 플랜 표시
- `resets_at`은 ISO8601 문자열 (예: `2026-07-14T03:29:59.895126+00:00`).

**참고 — `limits[]` 배열이 위 세 값을 정규화된 형태로 이미 담고 있음:**
- `{ kind: "session", group: "session", percent, resets_at }`
- `{ kind: "weekly_all", group: "weekly", percent, resets_at }`
- `{ kind: "weekly_scoped", group: "weekly", percent, resets_at, scope: { model: { display_name: "Fable" } } }`

구현 시 `limits[]`를 1차 소스로 쓰고, 없을 때 `five_hour`/`seven_day` top-level 필드로 폴백한다.

### 3.2 Codex

- 자격증명: `~/.codex/auth.json` → `tokens.access_token`, `tokens.account_id`, `tokens.id_token`.
  - `id_token` JWT payload의 `https://api.openai.com/auth.chatgpt_plan_type` (예: `pro`) → 플랜 표시.
- **라이브 (1차):** `GET https://chatgpt.com/backend-api/codex/usage`
  - 헤더: `Authorization: Bearer <access_token>`, `chatgpt-account-id: <account_id>`, Codex CLI와 동일한 `User-Agent`/`originator: codex_cli_rs`.
  - ⚠️ **주의:** 맨 curl로는 Cloudflare 관리형 챌린지(403)에 막힌다. TLS 지문 문제이며, Codex CLI 및 Tauri가 사용하는 Rust `reqwest`는 정상 통과할 것으로 예상. **구현 초기에 reqwest로 실제 통과 여부를 반드시 검증한다.** 통과하지 못하면 로컬 폴백을 1차 소스로 승격.
- **로컬 폴백 (검증됨) ✅:** 최신 `~/.codex/sessions/**/rollout-*.jsonl` 파일에서 마지막 `rate_limits` 스냅샷을 읽는다. 실제 캡처된 형태:
  ```json
  "rate_limits": {
    "limit_id": "codex",
    "primary":   { "used_percent": 73.0, "window_minutes": 300,   "resets_at": 1783661689 },
    "secondary": { "used_percent": 11.0, "window_minutes": 10080, "resets_at": 1784248489 },
    "credits": null,
    "plan_type": "prolite"
  }
  ```
  - `primary` (300분 = 5시간) → **Codex 5-hour window (보너스)**
  - `secondary` (10080분 = 7일) → **Codex Weekly limit**
  - `resets_at`은 unix epoch(초).
  - `plan_type` → 플랜 표시 (라이브가 실패했을 때).
- **Spark 주간 한도 — best-effort:** rollout 스냅샷의 `rate_limits`에는 Spark 전용 한도가 없다. 라이브 `/usage` 응답에 per-model / 추가 limit 항목으로 존재하는지 구현 중 확인한다.
  - 존재하면 → **GPT-5.3-Codex-Spark Weekly limit**으로 표시.
  - 존재하지 않으면 → 해당 `LimitWindow`를 `available: false`로 두고 UI에서 "사용 불가 / 데이터 없음"으로 표시(크래시 금지).

## 4. 아키텍처

```
┌───────────────────────────────────────────────┐
│  React + TS 프론트엔드 (webview)               │
│  Header(플랜배지/새로고침/설정) · ProviderCard │
│  · LimitBar · SettingsPanel                     │
│  react-i18next(EN/KO) · CSS 변수 테마           │
└───────────▲───────────────────────┬────────────┘
   invoke('get_usage')      listen('usage-updated')
            │                        │
┌───────────┴───────────────────────▼────────────┐
│  Rust 코어 (Tauri v2)                           │
│  commands: get_usage, get_settings, set_settings│
│  poller(interval+focus) → emit usage-updated    │
│  tray icon · notification(threshold)            │
│  ┌─────────────┐   ┌─────────────┐              │
│  │ providers:: │   │ providers:: │  → normalize │
│  │ claude      │   │ codex       │  → Snapshot   │
│  └─────────────┘   └─────────────┘              │
└─────────────────────────────────────────────────┘
```

### 4.1 Rust 모듈 경계

- `providers/claude.rs` — 자격증명 읽기, HTTP 요청, 원시 응답 파싱. **하는 일:** Claude 원시 usage → `RawClaudeUsage`. **의존:** `~/.claude/.credentials.json`, reqwest.
- `providers/codex.rs` — 자격증명/`id_token` 파싱, 라이브 요청, rollout 폴백. **하는 일:** Codex 원시 usage → `RawCodexUsage`. **의존:** `~/.codex/*`, reqwest.
- `model.rs` — `UsageSnapshot`, `LimitWindow`, `ProviderState` 정의 + `From<Raw…>` 정규화 로직. **의존:** 없음 (순수).
- `usage.rs` — `get_usage()` 오케스트레이션(두 provider 병렬 호출), 캐시 보관.
- `poller.rs` — interval + focus 트리거, `usage-updated` 이벤트 방출, threshold 알림 판정.
- `settings.rs` — 언어/테마/새로고침 간격/알림 임계치 영속화(`tauri-plugin-store` 또는 앱 config 디렉터리 JSON).
- `commands.rs` — Tauri command 등록.

각 provider 모듈은 "원시 데이터 획득"만 책임지고, 정규화는 `model.rs`가 전담한다. 덕분에 provider 파서를 UI/정규화와 독립적으로 테스트할 수 있다.

### 4.2 정규화 모델

```rust
enum ProviderId { Claude, Codex }
enum Source { Live, Cache }

struct UsageSnapshot {
    provider: ProviderId,
    plan: String,            // "Max 20x", "Pro" 등 (표시용 문자열)
    plan_raw: String,        // "max", "pro" 등 원시값
    source: Source,          // Live | Cache
    updated_at: i64,         // unix epoch (초)
    windows: Vec<LimitWindow>,
    error: Option<String>,   // provider 전체 실패 시 사용자용 메시지 키
}

struct LimitWindow {
    id: WindowId,            // 아래 enum
    used_percent: f64,       // 0.0 ~ 100.0
    resets_at: Option<i64>,  // unix epoch (초); 없으면 None
    available: bool,         // false면 데이터 없음(예: Spark 미제공)
}

enum WindowId {
    ClaudeSession,       // five_hour
    ClaudeWeeklyAll,     // seven_day
    ClaudeWeeklyFable,   // weekly_scoped(Fable)
    CodexFiveHour,       // primary (보너스)
    CodexWeekly,         // secondary
    CodexSparkWeekly,    // best-effort
}
```

- 리셋 시각은 모두 **unix epoch(초)로 정규화**하여 프론트로 전달 (Claude ISO8601 → epoch 변환, Codex는 그대로).
- 라벨은 `WindowId`를 i18n 키로 매핑하여 프론트에서 번역 (백엔드는 표시 문자열을 만들지 않음).

### 4.3 프론트엔드 컴포넌트

- `App` — 테마/언어 provider, `usage-updated` 리스너, 초기 `get_usage` 호출.
- `Header` — 새로고침 버튼(수동), 마지막 갱신 시각, 설정 진입.
- `ProviderCard` — provider별 카드. 상단에 플랜 배지, 하단에 `LimitBar` 목록. 강조색을 CSS 변수로 주입(`--accent`).
- `LimitBar` — 라벨 + 막대 바(퍼센트 채움, 강조색) + 퍼센트 텍스트 + 리셋까지 남은 시간 카운트다운. `available: false`면 흐린 "데이터 없음" 상태.
- `SettingsPanel` — 언어(EN/KO), 테마(Dark/Light/System), 자동 새로고침 간격, 알림 임계치.
- `EmptyState` — 자격증명 없음 시 "CLI 연결 필요" 안내.

### 4.4 테마

- CSS 변수 기반. `:root`(라이트) / `[data-theme="dark"]`(다크) / `prefers-color-scheme` 연동(System).
- provider 강조색은 카드 스코프 변수로: Claude `--accent: #D97757`, Codex `--accent: #5162ED`.
- 막대 바 채움/퍼센트 텍스트/배지에 강조색 사용, 배경/텍스트는 테마 토큰 사용.

### 4.5 국제화

- `react-i18next`, 기본 로케일 `en`, 추가 `ko`. 앱 최초 실행 시 OS 로케일 감지, 이후 설정값 우선.
- 모든 UI 문자열은 키로 관리. 리셋 시각 상대 표기("2시간 후 리셋")도 로케일별 포맷.

## 5. 새로고침 / 폴링 / 알림

- 자동 새로고침: 기본 간격(예: 60초, 설정 가능). 창 포커스 시 즉시 1회.
- 수동 새로고침: Header 버튼.
- 알림: 각 윈도우의 `used_percent`가 임계치(기본 80%, 100%)를 **넘어서는 순간** 1회 native 알림. 동일 윈도우/임계치 중복 알림 방지(상태 기억). `tauri-plugin-notification` 사용.
- 트레이 아이콘: 클릭 시 창 토글. (선택) 툴팁에 가장 임박한 한도 요약.

## 6. 오류 및 예외 상태

| 상황 | 처리 |
|------|------|
| 자격증명 파일 없음 | 해당 provider 카드에 "Claude/Codex CLI 로그인 필요" `EmptyState` |
| 401 / 토큰 만료 | 디스크에서 자격증명 재읽기 → 그래도 실패면 재로그인 안내 메시지. 인앱 OAuth 갱신은 MVP 제외 |
| 라이브 요청 실패(네트워크/Cloudflare) | 캐시/rollout 폴백 + `source: Cache` "캐시됨" 배지 |
| Codex rollout 파일 없음 | Codex 카드 부분 오류 상태(다른 provider는 정상) |
| Spark 데이터 없음 | 해당 `LimitWindow` `available: false`, "데이터 없음" 표시 |
| 한쪽 provider 실패 | 다른 provider는 독립적으로 정상 표시 (실패 격리) |

## 7. 테스트 전략

- **Rust 파서 유닛 테스트:** 실제 캡처한 픽스처 JSON 사용.
  - `oauth/usage` 응답 → `RawClaudeUsage` 파싱, `limits[]` 및 top-level 폴백 경로 모두.
  - Codex rollout `rate_limits` (primary/secondary 채워진 것 + null인 것) → `RawCodexUsage`.
  - `id_token` payload → plan_type 추출.
- **정규화 테스트:** `RawClaudeUsage`/`RawCodexUsage` → `UsageSnapshot` 매핑, ISO8601→epoch 변환, Fable 스코프 선택, Spark 미제공 시 `available:false`.
- **프론트 컴포넌트 테스트:** `LimitBar` 렌더(퍼센트 채움 폭, 강조색 적용, 카운트다운 텍스트, `available:false` 상태), 테마 전환, 로케일 전환.
- **폴백 로직 테스트:** 라이브 실패 시 캐시 소스로 전환되고 배지가 `Cache`인지.

## 8. MVP 범위 밖 (명시적 제외)

- 인앱 OAuth 토큰 갱신 플로우 (CLI가 토큰 갱신하는 것에 의존).
- 과거 사용량 추이 그래프/히스토리.
- 다중 계정 전환.
- 자동 업데이트(앱 자체 업데이트) 배포 파이프라인.

## 9. 열린 확인 항목 — 구현 스파이크(Task 6) 결과로 해결됨

1. **Codex 라이브 `/usage` Cloudflare 통과 여부 → 통과 못함 (해결: rollout 1차 승격).**
   `GET https://chatgpt.com/backend-api/codex/usage`는 curl **및 Rust reqwest** 모두 Cloudflare managed challenge(HTTP 403)를 받는다(브라우저 세션 없이는 불가). 애초에 Codex CLI도 별도 usage 엔드포인트를 쓰지 않고, 실제 `/responses` 스트림에 실려오는 `rate_limits`를 세션 rollout에 저장해 표시한다. 따라서 **최신 rollout 스냅샷을 Codex의 1차(사실상 유일) 소스로 사용**한다. 신선도는 Codex CLI 상태줄과 동일(마지막 API 턴 기준). `source`는 항상 `Cache`, `updated_at`은 판독값이 나온 rollout 파일의 mtime으로 truthful하게 표기.
   - rollout에는 세션 중 `primary/secondary`가 `null`인 스냅샷도 섞여 있으므로, **파일 최신순 + 파일 내 역방향으로 primary 또는 secondary가 non-null인 가장 최근 판독값**을 선택한다.
   - 한계: 사용자가 Codex를 오래 안 썼으면 데이터가 오래됐을 수 있다(예: 5시간 윈도우 판독값의 resets_at이 과거일 수 있음). 이는 Codex 자체의 한계와 동일하며 `updated_at`과 과거 resets_at 표기로 정직하게 드러낸다. 라이브 HTTP 시도는 매 새로고침 지연·slop만 유발하므로 제거함.
2. **Spark 주간 한도 위치 → 로컬/라이브 어디에도 없음 (해결: unavailable 유지).**
   로컬 rollout `rate_limits`에는 `primary`/`secondary`/`credits`/`plan_type`만 존재하고 Spark 전용·per-model 한도가 없다. 라이브 엔드포인트는 막혀 있다. 따라서 `CodexSparkWeekly`는 `available:false`("데이터 없음")로 표시한다 — 사용자와 합의한 best-effort 결과.
3. **Claude `limits[]`의 다른 scoped 한도 → Fable만 선택(무시).** Task 2에서 `weekly_scoped` 중 `scope.model.display_name == "Fable"`만 매핑, 나머지는 무시(이슈 범위). 해결됨.

### 이후 코드에 반영된 결정 (Task 6)
- Codex `get()`: `latest_rollout_snapshot()`(최신 non-null 판독값 + mtime) → `parse_rate_limits(json, plan, Cache, mtime)`. 플랜은 `auth.json` id_token의 `chatgpt_plan_type`(권위) 우선, 없으면 rollout의 `plan_type`.
- 죽은 라이브 배관(`fetch_live`/`CodexAuth`의 토큰 필드/`CodexError::Http`) 제거로 Task 5 리뷰의 auth 하드의존·죽은 조건식 지적도 해소.
