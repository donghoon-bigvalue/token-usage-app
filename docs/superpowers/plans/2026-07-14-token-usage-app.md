# Token Usage App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude/Codex 구독 사용량과 리셋 시각을 막대 바로 보여주는 Tauri v2 데스크톱 앱을 만든다.

**Architecture:** Rust 코어가 두 provider(Claude oauth/usage 엔드포인트, Codex 라이브 usage + 로컬 rollout 폴백)에서 원시 사용량을 받아 하나의 `UsageSnapshot`으로 정규화하고, Tauri command/event로 React 프론트에 전달한다. 프론트는 provider별 카드와 막대 바로 렌더하며 테마(Dark/Light/System)와 i18n(EN/KO), 트레이·자동 새로고침·알림을 지원한다.

**Tech Stack:** Tauri v2, Rust (reqwest, serde, tokio), React 18 + TypeScript + Vite, react-i18next, vitest + @testing-library/react.

## Global Constraints

- Tauri v2 (`@tauri-apps/api` v2, `tauri` crate 2.x). Rust edition 2021.
- Claude 강조색 `#D97757`, Codex 강조색 `#5162ED` (정확히 이 값).
- Dark Mode / Light Mode / System 모두 지원.
- 기본 UI 언어 영어(`en`), 한국어(`ko`) 지원. 모든 UI 문자열은 i18n 키로 관리하고 백엔드는 표시 문자열을 생성하지 않는다.
- 리셋 시각은 백엔드에서 모두 **unix epoch 초(i64)** 로 정규화하여 프론트에 전달한다.
- 사용자 대상 커뮤니케이션(설명/보고)은 한국어로 한다. 코드 식별자·주석은 영어.
- 한쪽 provider 실패가 다른 provider 표시를 막지 않는다(실패 격리).
- 자격증명은 읽기 전용으로 접근한다(`~/.claude/.credentials.json`, `~/.codex/auth.json`, `~/.codex/sessions/**`). 수정하지 않는다.
- 커밋 메시지 말미: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## 파일 구조

```
token-usage-app/
├─ src/                          # React 프론트엔드
│  ├─ main.tsx                   # 엔트리, i18n/theme 초기화
│  ├─ App.tsx                    # 최상위: 상태·이벤트 리스너·레이아웃
│  ├─ i18n.ts                    # react-i18next 설정
│  ├─ theme.ts                   # 테마 적용 로직 (data-theme 토글)
│  ├─ lib/
│  │  ├─ types.ts                # UsageSnapshot 등 TS 타입(백엔드 미러)
│  │  ├─ usage.ts                # invoke('get_usage') 래퍼 + 이벤트 구독
│  │  ├─ settings.ts             # get/set_settings 래퍼
│  │  └─ format.ts               # 리셋 카운트다운 포맷 (로케일별)
│  ├─ components/
│  │  ├─ LimitBar.tsx            # 막대 바 하나
│  │  ├─ ProviderCard.tsx        # provider 카드(플랜 배지 + LimitBar 목록)
│  │  ├─ Header.tsx              # 새로고침/마지막 갱신/설정 진입
│  │  ├─ SettingsPanel.tsx       # 언어/테마/간격/임계치
│  │  └─ EmptyState.tsx          # 자격증명 없음 안내
│  ├─ locales/
│  │  ├─ en.json
│  │  └─ ko.json
│  └─ styles/
│     └─ theme.css               # CSS 변수(라이트/다크), provider 강조색
├─ src-tauri/
│  ├─ Cargo.toml
│  ├─ tauri.conf.json
│  ├─ capabilities/default.json  # notification/store 권한
│  └─ src/
│     ├─ main.rs                 # 엔트리 → lib::run()
│     ├─ lib.rs                  # Builder, command/plugin 등록, tray, poller 시작
│     ├─ model.rs                # UsageSnapshot/LimitWindow/WindowId + 정규화
│     ├─ providers/
│     │  ├─ mod.rs
│     │  ├─ claude.rs            # 자격증명 읽기, oauth/usage 파싱/정규화
│     │  └─ codex.rs             # auth/id_token, 라이브+rollout 폴백/정규화
│     ├─ usage.rs                # get_usage 오케스트레이션 + 캐시
│     ├─ settings.rs             # 설정 영속화(tauri-plugin-store)
│     ├─ poller.rs               # interval+focus 폴링, usage-updated, 알림
│     └─ commands.rs             # Tauri command 등록부
└─ docs/superpowers/...
```

---

## Phase 0 — 스캐폴딩

### Task 0: Tauri v2 + React/TS/Vite 프로젝트 생성

**Files:**
- Create: 프로젝트 루트 전체 (`package.json`, `src-tauri/*`, `src/*` 기본 템플릿)
- Modify: `src-tauri/Cargo.toml`, `package.json` (의존성 추가)

**Interfaces:**
- Produces: 실행 가능한 Tauri 앱 셸. `cargo test`(src-tauri)와 `npm test`(vitest)가 동작하는 테스트 하니스.

- [ ] **Step 1: Tauri 앱 스캐폴드 생성**

현재 디렉터리는 비어있는 git 저장소(`docs/`만 존재). 루트에 직접 생성한다.

Run:
```bash
npm create tauri-app@latest . -- --template react-ts --manager npm --yes
```
프롬프트가 뜨면: 프론트 프레임워크 React, TS, 패키지 매니저 npm 선택. `.` 대상이 비어있지 않다는 경고가 나오면 기존 `docs/`·`.git`은 유지하도록 진행.

- [ ] **Step 2: 의존성 설치 + 프론트 라이브러리 추가**

Run:
```bash
npm install
npm install react-i18next i18next i18next-browser-languagedetector
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @vitest/coverage-v8
npm install @tauri-apps/plugin-notification @tauri-apps/plugin-store
```

- [ ] **Step 3: Rust 의존성 추가**

`src-tauri/Cargo.toml`의 `[dependencies]`에 추가:
```toml
reqwest = { version = "0.12", features = ["json", "rustls-tls"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
chrono = "0.4"
dirs = "5"
tauri-plugin-notification = "2"
tauri-plugin-store = "2"
base64 = "0.22"
thiserror = "2"
```

- [ ] **Step 4: vitest 설정**

Create `vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    globals: true,
  },
});
```

Create `src/test-setup.ts`:
```ts
import "@testing-library/jest-dom";
```

`package.json`의 `scripts`에 추가: `"test": "vitest run"`, `"test:watch": "vitest"`.

- [ ] **Step 5: 스모크 확인**

Run:
```bash
cd src-tauri && cargo test 2>&1 | tail -5 && cd ..
npm test 2>&1 | tail -10
```
Expected: 양쪽 모두 "0 tests" 혹은 통과(에러 없이 러너 기동). 컴파일 에러가 없으면 성공.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: Tauri v2 + React/TS 스캐폴드 및 테스트 하니스"
```

---

## Phase 1 — Rust 데이터 모델 & 정규화

### Task 1: 정규화 모델과 WindowId 정의

**Files:**
- Create: `src-tauri/src/model.rs`
- Modify: `src-tauri/src/lib.rs` (`mod model;` 추가)
- Test: `src-tauri/src/model.rs` (하단 `#[cfg(test)]`)

**Interfaces:**
- Produces:
  - `enum ProviderId { Claude, Codex }` (serde: `rename_all = "lowercase"`)
  - `enum Source { Live, Cache }`
  - `enum WindowId { ClaudeSession, ClaudeWeeklyAll, ClaudeWeeklyFable, CodexFiveHour, CodexWeekly, CodexSparkWeekly }` (serde: `rename_all = "snake_case"`)
  - `struct LimitWindow { id: WindowId, used_percent: f64, resets_at: Option<i64>, available: bool }`
  - `struct UsageSnapshot { provider: ProviderId, plan: String, plan_raw: String, source: Source, updated_at: i64, windows: Vec<LimitWindow>, error: Option<String> }`
  - `fn iso8601_to_epoch(s: &str) -> Option<i64>`

- [ ] **Step 1: Write the failing test**

`src-tauri/src/model.rs` 하단에 추가:
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso8601_parses_to_epoch() {
        // 2026-07-14T03:29:59.895126+00:00 → 1784000999
        let e = iso8601_to_epoch("2026-07-14T03:29:59.895126+00:00").unwrap();
        assert_eq!(e, 1784000999);
    }

    #[test]
    fn iso8601_bad_input_is_none() {
        assert!(iso8601_to_epoch("not-a-date").is_none());
    }

    #[test]
    fn window_id_serializes_snake_case() {
        let j = serde_json::to_string(&WindowId::ClaudeWeeklyFable).unwrap();
        assert_eq!(j, "\"claude_weekly_fable\"");
    }

    #[test]
    fn snapshot_serializes_provider_lowercase() {
        let s = UsageSnapshot {
            provider: ProviderId::Claude,
            plan: "Max 20x".into(),
            plan_raw: "max".into(),
            source: Source::Live,
            updated_at: 0,
            windows: vec![],
            error: None,
        };
        let j = serde_json::to_value(&s).unwrap();
        assert_eq!(j["provider"], "claude");
        assert_eq!(j["source"], "live");
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test model:: 2>&1 | tail -15`
Expected: FAIL — `model` 항목/타입 미정의로 컴파일 에러.

- [ ] **Step 3: Write minimal implementation**

`src-tauri/src/model.rs` 상단(테스트 위)에 추가:
```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProviderId {
    Claude,
    Codex,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Live,
    Cache,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WindowId {
    ClaudeSession,
    ClaudeWeeklyAll,
    ClaudeWeeklyFable,
    CodexFiveHour,
    CodexWeekly,
    CodexSparkWeekly,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LimitWindow {
    pub id: WindowId,
    pub used_percent: f64,
    pub resets_at: Option<i64>,
    pub available: bool,
}

impl LimitWindow {
    pub fn unavailable(id: WindowId) -> Self {
        Self { id, used_percent: 0.0, resets_at: None, available: false }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageSnapshot {
    pub provider: ProviderId,
    pub plan: String,
    pub plan_raw: String,
    pub source: Source,
    pub updated_at: i64,
    pub windows: Vec<LimitWindow>,
    pub error: Option<String>,
}

pub fn iso8601_to_epoch(s: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(s).ok().map(|d| d.timestamp())
}
```

`src-tauri/src/lib.rs` 최상단에 `mod model;` 추가.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test model:: 2>&1 | tail -15`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/model.rs src-tauri/src/lib.rs
git commit -m "feat(core): 정규화 데이터 모델(UsageSnapshot/LimitWindow) 정의"
```

---

## Phase 2 — Claude Provider

### Task 2: Claude 응답 파싱 및 정규화

**Files:**
- Create: `src-tauri/src/providers/mod.rs`, `src-tauri/src/providers/claude.rs`
- Create: `src-tauri/tests/fixtures/claude_usage.json`
- Modify: `src-tauri/src/lib.rs` (`mod providers;`)
- Test: `src-tauri/src/providers/claude.rs` (`#[cfg(test)]`)

**Interfaces:**
- Consumes: `model::{UsageSnapshot, LimitWindow, WindowId, ProviderId, Source, iso8601_to_epoch}`
- Produces:
  - `pub fn parse_usage(body: &str, subscription_type: &str, rate_limit_tier: &str, updated_at: i64) -> Result<UsageSnapshot, ClaudeError>`
  - `pub fn plan_label(subscription_type: &str, rate_limit_tier: &str) -> String`
  - `pub enum ClaudeError` (thiserror)

- [ ] **Step 1: 실제 픽스처 저장**

Create `src-tauri/tests/fixtures/claude_usage.json` (실제 캡처, 축약):
```json
{
  "five_hour": { "utilization": 6.0, "resets_at": "2026-07-14T03:29:59.895126+00:00" },
  "seven_day": { "utilization": 26.0, "resets_at": "2026-07-16T05:59:59.895148+00:00" },
  "limits": [
    { "kind": "session", "group": "session", "percent": 6, "resets_at": "2026-07-14T03:29:59.895126+00:00", "scope": null, "is_active": false },
    { "kind": "weekly_all", "group": "weekly", "percent": 26, "resets_at": "2026-07-16T05:59:59.895148+00:00", "scope": null, "is_active": true },
    { "kind": "weekly_scoped", "group": "weekly", "percent": 0, "resets_at": "2026-07-16T05:59:59.895377+00:00", "scope": { "model": { "id": null, "display_name": "Fable" }, "surface": null }, "is_active": false }
  ]
}
```

- [ ] **Step 2: Write the failing test**

`src-tauri/src/providers/claude.rs` 하단:
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::WindowId;

    const FIXTURE: &str = include_str!("../../tests/fixtures/claude_usage.json");

    #[test]
    fn parses_three_windows() {
        let s = parse_usage(FIXTURE, "max", "default_claude_max_20x", 1000).unwrap();
        assert_eq!(s.windows.len(), 3);
        let session = s.windows.iter().find(|w| w.id == WindowId::ClaudeSession).unwrap();
        assert_eq!(session.used_percent, 6.0);
        assert_eq!(session.resets_at, Some(1784000999));
        let fable = s.windows.iter().find(|w| w.id == WindowId::ClaudeWeeklyFable).unwrap();
        assert!(fable.available);
        assert_eq!(fable.used_percent, 0.0);
    }

    #[test]
    fn plan_label_max_20x() {
        assert_eq!(plan_label("max", "default_claude_max_20x"), "Max 20x");
    }

    #[test]
    fn falls_back_to_top_level_when_limits_missing() {
        let body = r#"{"five_hour":{"utilization":10.0,"resets_at":"2026-07-14T03:29:59+00:00"},"seven_day":{"utilization":20.0,"resets_at":"2026-07-16T05:59:59+00:00"}}"#;
        let s = parse_usage(body, "max", "default_claude_max_20x", 0).unwrap();
        // session + weekly_all 최소 2개, fable은 unavailable
        let fable = s.windows.iter().find(|w| w.id == WindowId::ClaudeWeeklyFable).unwrap();
        assert!(!fable.available);
    }
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd src-tauri && cargo test claude:: 2>&1 | tail -15`
Expected: FAIL — `parse_usage`/`plan_label` 미정의.

- [ ] **Step 4: Write minimal implementation**

Create `src-tauri/src/providers/mod.rs`:
```rust
pub mod claude;
pub mod codex;
```

`src-tauri/src/lib.rs`에 `mod providers;` 추가.

Create `src-tauri/src/providers/claude.rs` (테스트 위):
```rust
use crate::model::{iso8601_to_epoch, LimitWindow, ProviderId, Source, UsageSnapshot, WindowId};
use serde::Deserialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ClaudeError {
    #[error("credentials not found")]
    NoCredentials,
    #[error("http error: {0}")]
    Http(String),
    #[error("parse error: {0}")]
    Parse(String),
}

#[derive(Deserialize)]
struct Raw {
    five_hour: Option<Window>,
    seven_day: Option<Window>,
    #[serde(default)]
    limits: Vec<RawLimit>,
}

#[derive(Deserialize)]
struct Window {
    utilization: Option<f64>,
    resets_at: Option<String>,
}

#[derive(Deserialize)]
struct RawLimit {
    kind: String,
    #[serde(default)]
    percent: f64,
    resets_at: Option<String>,
    #[serde(default)]
    scope: Option<Scope>,
}

#[derive(Deserialize)]
struct Scope {
    model: Option<ScopeModel>,
}

#[derive(Deserialize)]
struct ScopeModel {
    display_name: Option<String>,
}

pub fn plan_label(subscription_type: &str, rate_limit_tier: &str) -> String {
    // rate_limit_tier 예: default_claude_max_20x → "Max 20x"
    if rate_limit_tier.contains("max_20x") {
        return "Max 20x".into();
    }
    if rate_limit_tier.contains("max_5x") {
        return "Max 5x".into();
    }
    match subscription_type {
        "max" => "Max".into(),
        "pro" => "Pro".into(),
        other => {
            let mut c = other.chars();
            match c.next() {
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                None => "Unknown".into(),
            }
        }
    }
}

pub fn parse_usage(
    body: &str,
    subscription_type: &str,
    rate_limit_tier: &str,
    updated_at: i64,
) -> Result<UsageSnapshot, ClaudeError> {
    let raw: Raw = serde_json::from_str(body).map_err(|e| ClaudeError::Parse(e.to_string()))?;
    let mut windows = Vec::new();

    // 1차: limits[]에서 뽑기
    let mut have_session = false;
    let mut have_weekly_all = false;
    let mut have_fable = false;
    for l in &raw.limits {
        let epoch = l.resets_at.as_deref().and_then(iso8601_to_epoch);
        match l.kind.as_str() {
            "session" => {
                windows.push(LimitWindow { id: WindowId::ClaudeSession, used_percent: l.percent, resets_at: epoch, available: true });
                have_session = true;
            }
            "weekly_all" => {
                windows.push(LimitWindow { id: WindowId::ClaudeWeeklyAll, used_percent: l.percent, resets_at: epoch, available: true });
                have_weekly_all = true;
            }
            "weekly_scoped" => {
                let is_fable = l.scope.as_ref()
                    .and_then(|s| s.model.as_ref())
                    .and_then(|m| m.display_name.as_deref())
                    .map(|n| n.eq_ignore_ascii_case("Fable"))
                    .unwrap_or(false);
                if is_fable {
                    windows.push(LimitWindow { id: WindowId::ClaudeWeeklyFable, used_percent: l.percent, resets_at: epoch, available: true });
                    have_fable = true;
                }
            }
            _ => {}
        }
    }

    // 2차: top-level 폴백
    if !have_session {
        if let Some(w) = &raw.five_hour {
            windows.push(LimitWindow {
                id: WindowId::ClaudeSession,
                used_percent: w.utilization.unwrap_or(0.0),
                resets_at: w.resets_at.as_deref().and_then(iso8601_to_epoch),
                available: true,
            });
        }
    }
    if !have_weekly_all {
        if let Some(w) = &raw.seven_day {
            windows.push(LimitWindow {
                id: WindowId::ClaudeWeeklyAll,
                used_percent: w.utilization.unwrap_or(0.0),
                resets_at: w.resets_at.as_deref().and_then(iso8601_to_epoch),
                available: true,
            });
        }
    }
    if !have_fable {
        windows.push(LimitWindow::unavailable(WindowId::ClaudeWeeklyFable));
    }

    Ok(UsageSnapshot {
        provider: ProviderId::Claude,
        plan: plan_label(subscription_type, rate_limit_tier),
        plan_raw: subscription_type.to_string(),
        source: Source::Live,
        updated_at,
        windows,
        error: None,
    })
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd src-tauri && cargo test claude:: 2>&1 | tail -15`
Expected: PASS (3 passed).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/providers src-tauri/tests/fixtures/claude_usage.json src-tauri/src/lib.rs
git commit -m "feat(claude): oauth/usage 응답 파싱·정규화 + 픽스처 테스트"
```

---

### Task 3: Claude 자격증명 읽기 + 라이브 fetch

**Files:**
- Modify: `src-tauri/src/providers/claude.rs`
- Test: `src-tauri/src/providers/claude.rs`

**Interfaces:**
- Consumes: `parse_usage`
- Produces:
  - `pub struct ClaudeCreds { pub access_token: String, pub subscription_type: String, pub rate_limit_tier: String }`
  - `pub fn read_credentials(home: &std::path::Path) -> Result<ClaudeCreds, ClaudeError>`
  - `pub async fn fetch(creds: &ClaudeCreds) -> Result<UsageSnapshot, ClaudeError>`
  - `pub async fn get() -> Result<UsageSnapshot, ClaudeError>` (홈 자동 탐색 → read → fetch)

- [ ] **Step 1: Write the failing test (자격증명 파싱)**

`claude.rs` tests 모듈에 추가:
```rust
    #[test]
    fn reads_credentials_from_file() {
        let dir = std::env::temp_dir().join(format!("claude-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join(".credentials.json"),
            r#"{"claudeAiOauth":{"accessToken":"tok123","subscriptionType":"max","rateLimitTier":"default_claude_max_20x"}}"#,
        ).unwrap();
        let creds = read_credentials(&dir).unwrap();
        assert_eq!(creds.access_token, "tok123");
        assert_eq!(creds.subscription_type, "max");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn missing_credentials_errors() {
        let dir = std::env::temp_dir().join("claude-nonexistent-xyz");
        assert!(matches!(read_credentials(&dir), Err(ClaudeError::NoCredentials)));
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test claude::tests::reads_credentials 2>&1 | tail -10`
Expected: FAIL — `read_credentials`/`ClaudeCreds` 미정의.

- [ ] **Step 3: Write minimal implementation**

`claude.rs`에 추가:
```rust
use std::path::Path;

pub struct ClaudeCreds {
    pub access_token: String,
    pub subscription_type: String,
    pub rate_limit_tier: String,
}

#[derive(Deserialize)]
struct CredFile {
    #[serde(rename = "claudeAiOauth")]
    oauth: Option<OauthBlock>,
}
#[derive(Deserialize)]
struct OauthBlock {
    #[serde(rename = "accessToken")]
    access_token: String,
    #[serde(rename = "subscriptionType")]
    subscription_type: Option<String>,
    #[serde(rename = "rateLimitTier")]
    rate_limit_tier: Option<String>,
}

pub fn read_credentials(claude_home: &Path) -> Result<ClaudeCreds, ClaudeError> {
    let path = claude_home.join(".credentials.json");
    let txt = std::fs::read_to_string(&path).map_err(|_| ClaudeError::NoCredentials)?;
    let f: CredFile = serde_json::from_str(&txt).map_err(|e| ClaudeError::Parse(e.to_string()))?;
    let o = f.oauth.ok_or(ClaudeError::NoCredentials)?;
    Ok(ClaudeCreds {
        access_token: o.access_token,
        subscription_type: o.subscription_type.unwrap_or_else(|| "unknown".into()),
        rate_limit_tier: o.rate_limit_tier.unwrap_or_default(),
    })
}

pub async fn fetch(creds: &ClaudeCreds) -> Result<UsageSnapshot, ClaudeError> {
    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.anthropic.com/api/oauth/usage")
        .header("Authorization", format!("Bearer {}", creds.access_token))
        .header("anthropic-beta", "oauth-2025-04-20")
        .send()
        .await
        .map_err(|e| ClaudeError::Http(e.to_string()))?;
    if !resp.status().is_success() {
        return Err(ClaudeError::Http(format!("status {}", resp.status())));
    }
    let body = resp.text().await.map_err(|e| ClaudeError::Http(e.to_string()))?;
    let now = chrono::Utc::now().timestamp();
    parse_usage(&body, &creds.subscription_type, &creds.rate_limit_tier, now)
}

pub async fn get() -> Result<UsageSnapshot, ClaudeError> {
    let home = dirs::home_dir().ok_or(ClaudeError::NoCredentials)?.join(".claude");
    let creds = read_credentials(&home)?;
    fetch(&creds).await
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test claude::tests::reads_credentials claude::tests::missing_credentials 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Live 스모크 (수동, 네트워크)**

Run:
```bash
cd src-tauri && cargo test claude_live_smoke -- --ignored --nocapture 2>&1 | tail -20
```
아래 테스트를 `#[ignore]`로 추가(실계정 필요, CI 제외):
```rust
    #[tokio::test]
    #[ignore]
    async fn claude_live_smoke() {
        let s = super::get().await.unwrap();
        assert_eq!(s.windows.len(), 3);
        println!("plan={} windows={:?}", s.plan, s.windows);
    }
```
Expected: 실제 3개 윈도우 출력, 퍼센트/리셋 채워짐.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/providers/claude.rs
git commit -m "feat(claude): 자격증명 읽기 + oauth/usage 라이브 fetch"
```

---

## Phase 3 — Codex Provider

### Task 4: Codex rate_limits 파싱 및 정규화 (rollout/공통)

**Files:**
- Create: `src-tauri/src/providers/codex.rs`
- Create: `src-tauri/tests/fixtures/codex_rate_limits.json`, `src-tauri/tests/fixtures/codex_rate_limits_null.json`
- Test: `src-tauri/src/providers/codex.rs`

**Interfaces:**
- Consumes: `model::*`
- Produces:
  - `pub fn parse_rate_limits(json: &str, plan_raw: &str, source: Source, updated_at: i64) -> Result<UsageSnapshot, CodexError>`
  - `pub fn plan_label(plan_raw: &str) -> String`
  - `pub enum CodexError` (thiserror)

`parse_rate_limits`가 받는 JSON은 `rate_limits` 객체 자체(`{ "primary": {...}, "secondary": {...}, "plan_type": "..." }`)이며, `primary`→`CodexFiveHour`(보너스), `secondary`→`CodexWeekly`로 매핑. Spark는 이 객체에 없으면 `CodexSparkWeekly`를 `unavailable`로 넣는다.

- [ ] **Step 1: 픽스처 저장 (실제 캡처)**

Create `src-tauri/tests/fixtures/codex_rate_limits.json`:
```json
{
  "limit_id": "codex",
  "primary":   { "used_percent": 73.0, "window_minutes": 300,   "resets_at": 1783661689 },
  "secondary": { "used_percent": 11.0, "window_minutes": 10080, "resets_at": 1784248489 },
  "credits": null,
  "plan_type": "prolite"
}
```

Create `src-tauri/tests/fixtures/codex_rate_limits_null.json`:
```json
{ "limit_id": "premium", "primary": null, "secondary": null, "credits": null, "plan_type": "prolite" }
```

- [ ] **Step 2: Write the failing test**

`codex.rs` 하단:
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Source, WindowId};

    const FILLED: &str = include_str!("../../tests/fixtures/codex_rate_limits.json");
    const NULLED: &str = include_str!("../../tests/fixtures/codex_rate_limits_null.json");

    #[test]
    fn parses_primary_and_secondary() {
        let s = parse_rate_limits(FILLED, "pro", Source::Cache, 5).unwrap();
        let five = s.windows.iter().find(|w| w.id == WindowId::CodexFiveHour).unwrap();
        assert_eq!(five.used_percent, 73.0);
        assert_eq!(five.resets_at, Some(1783661689));
        let week = s.windows.iter().find(|w| w.id == WindowId::CodexWeekly).unwrap();
        assert_eq!(week.used_percent, 11.0);
        let spark = s.windows.iter().find(|w| w.id == WindowId::CodexSparkWeekly).unwrap();
        assert!(!spark.available);
        assert_eq!(s.source, Source::Cache);
    }

    #[test]
    fn null_windows_are_unavailable() {
        let s = parse_rate_limits(NULLED, "pro", Source::Cache, 0).unwrap();
        let five = s.windows.iter().find(|w| w.id == WindowId::CodexFiveHour).unwrap();
        assert!(!five.available);
        let week = s.windows.iter().find(|w| w.id == WindowId::CodexWeekly).unwrap();
        assert!(!week.available);
    }

    #[test]
    fn plan_label_maps_known() {
        assert_eq!(plan_label("pro"), "Pro");
        assert_eq!(plan_label("prolite"), "Pro (Lite)");
        assert_eq!(plan_label("plus"), "Plus");
    }
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd src-tauri && cargo test codex::tests::parses 2>&1 | tail -12`
Expected: FAIL — 미정의.

- [ ] **Step 4: Write minimal implementation**

Create `src-tauri/src/providers/codex.rs` (테스트 위):
```rust
use crate::model::{LimitWindow, ProviderId, Source, UsageSnapshot, WindowId};
use serde::Deserialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum CodexError {
    #[error("credentials not found")]
    NoCredentials,
    #[error("no rollout data")]
    NoRollout,
    #[error("http error: {0}")]
    Http(String),
    #[error("parse error: {0}")]
    Parse(String),
}

#[derive(Deserialize)]
struct RateLimits {
    primary: Option<Bucket>,
    secondary: Option<Bucket>,
    #[serde(default)]
    plan_type: Option<String>,
}

#[derive(Deserialize)]
struct Bucket {
    #[serde(default)]
    used_percent: f64,
    resets_at: Option<i64>,
}

pub fn plan_label(plan_raw: &str) -> String {
    match plan_raw {
        "pro" => "Pro".into(),
        "prolite" => "Pro (Lite)".into(),
        "plus" => "Plus".into(),
        "team" => "Team".into(),
        "enterprise" => "Enterprise".into(),
        "free" => "Free".into(),
        other if other.is_empty() => "Unknown".into(),
        other => {
            let mut c = other.chars();
            c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
        }
    }
}

fn window_from(bucket: &Option<Bucket>, id: WindowId) -> LimitWindow {
    match bucket {
        Some(b) => LimitWindow { id, used_percent: b.used_percent, resets_at: b.resets_at, available: true },
        None => LimitWindow::unavailable(id),
    }
}

pub fn parse_rate_limits(
    json: &str,
    plan_raw: &str,
    source: Source,
    updated_at: i64,
) -> Result<UsageSnapshot, CodexError> {
    let rl: RateLimits = serde_json::from_str(json).map_err(|e| CodexError::Parse(e.to_string()))?;
    let effective_plan = if plan_raw.is_empty() {
        rl.plan_type.clone().unwrap_or_default()
    } else {
        plan_raw.to_string()
    };
    let windows = vec![
        window_from(&rl.primary, WindowId::CodexFiveHour),
        window_from(&rl.secondary, WindowId::CodexWeekly),
        // Spark: rate_limits 스냅샷엔 없음 → 라이브 경로(Task 5)에서 채우거나 unavailable
        LimitWindow::unavailable(WindowId::CodexSparkWeekly),
    ];
    Ok(UsageSnapshot {
        provider: ProviderId::Codex,
        plan: plan_label(&effective_plan),
        plan_raw: effective_plan,
        source,
        updated_at,
        windows,
        error: None,
    })
}
```

`src-tauri/src/providers/mod.rs`는 Task 2에서 이미 `pub mod codex;` 포함.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd src-tauri && cargo test codex::tests 2>&1 | tail -12`
Expected: PASS (3 passed).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/providers/codex.rs src-tauri/tests/fixtures/codex_rate_limits*.json
git commit -m "feat(codex): rate_limits 파싱·정규화 + 픽스처 테스트"
```

---

### Task 5: Codex rollout 폴백 리더 + id_token plan + 라이브 fetch + 오케스트레이션

**Files:**
- Modify: `src-tauri/src/providers/codex.rs`
- Create: `src-tauri/tests/fixtures/rollout_sample.jsonl`
- Test: `src-tauri/src/providers/codex.rs`

**Interfaces:**
- Consumes: `parse_rate_limits`, `plan_label`
- Produces:
  - `pub struct CodexAuth { pub access_token: String, pub account_id: String, pub plan_type: String }`
  - `pub fn read_auth(codex_home: &Path) -> Result<CodexAuth, CodexError>` (auth.json + id_token JWT의 plan_type)
  - `pub fn latest_rollout_rate_limits(codex_home: &Path) -> Result<String, CodexError>` (최신 rollout에서 마지막 rate_limits JSON 문자열)
  - `pub async fn fetch_live(auth: &CodexAuth) -> Result<UsageSnapshot, CodexError>`
  - `pub async fn get() -> Result<UsageSnapshot, CodexError>` (라이브 시도 → 실패 시 rollout 폴백)

- [ ] **Step 1: rollout 픽스처 저장**

Create `src-tauri/tests/fixtures/rollout_sample.jsonl` (2줄; 마지막 줄이 최신 rate_limits):
```
{"type":"event","payload":{"rate_limits":{"limit_id":"codex","primary":{"used_percent":40.0,"window_minutes":300,"resets_at":1783661000},"secondary":{"used_percent":8.0,"window_minutes":10080,"resets_at":1784248000},"plan_type":"prolite"}}}
{"type":"event","payload":{"rate_limits":{"limit_id":"codex","primary":{"used_percent":73.0,"window_minutes":300,"resets_at":1783661689},"secondary":{"used_percent":11.0,"window_minutes":10080,"resets_at":1784248489},"plan_type":"prolite"}}}
```

- [ ] **Step 2: Write the failing test**

`codex.rs` tests 모듈에 추가:
```rust
    #[test]
    fn extracts_last_rate_limits_from_rollout() {
        let dir = std::env::temp_dir().join(format!("codex-roll-{}", std::process::id()));
        let sdir = dir.join("sessions/2026/07/14");
        std::fs::create_dir_all(&sdir).unwrap();
        let content = include_str!("../../tests/fixtures/rollout_sample.jsonl");
        std::fs::write(sdir.join("rollout-2026-07-14T09-00-00-abc.jsonl"), content).unwrap();
        let rl = latest_rollout_rate_limits(&dir).unwrap();
        // 마지막(최신) 스냅샷: primary 73.0
        assert!(rl.contains("73"));
        let s = parse_rate_limits(&rl, "", Source::Cache, 0).unwrap();
        let five = s.windows.iter().find(|w| w.id == WindowId::CodexFiveHour).unwrap();
        assert_eq!(five.used_percent, 73.0);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn decodes_plan_type_from_id_token() {
        // payload: {"https://api.openai.com/auth":{"chatgpt_plan_type":"pro"}}
        let payload = "eyJodHRwczovL2FwaS5vcGVuYWkuY29tL2F1dGgiOnsiY2hhdGdwdF9wbGFuX3R5cGUiOiJwcm8ifX0";
        let jwt = format!("aaa.{}.bbb", payload);
        assert_eq!(plan_from_id_token(&jwt), Some("pro".to_string()));
    }
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd src-tauri && cargo test codex::tests::extracts codex::tests::decodes 2>&1 | tail -12`
Expected: FAIL — 미정의.

- [ ] **Step 4: Write minimal implementation**

`codex.rs`에 추가:
```rust
use base64::Engine;
use std::path::{Path, PathBuf};

pub struct CodexAuth {
    pub access_token: String,
    pub account_id: String,
    pub plan_type: String,
}

#[derive(Deserialize)]
struct AuthFile {
    tokens: Option<Tokens>,
}
#[derive(Deserialize)]
struct Tokens {
    access_token: String,
    account_id: Option<String>,
    id_token: Option<String>,
}

pub fn plan_from_id_token(id_token: &str) -> Option<String> {
    let payload = id_token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(payload).ok()?;
    let v: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    v.get("https://api.openai.com/auth")?
        .get("chatgpt_plan_type")?
        .as_str()
        .map(|s| s.to_string())
}

pub fn read_auth(codex_home: &Path) -> Result<CodexAuth, CodexError> {
    let txt = std::fs::read_to_string(codex_home.join("auth.json"))
        .map_err(|_| CodexError::NoCredentials)?;
    let f: AuthFile = serde_json::from_str(&txt).map_err(|e| CodexError::Parse(e.to_string()))?;
    let t = f.tokens.ok_or(CodexError::NoCredentials)?;
    let plan_type = t.id_token.as_deref().and_then(plan_from_id_token).unwrap_or_default();
    Ok(CodexAuth {
        access_token: t.access_token,
        account_id: t.account_id.unwrap_or_default(),
        plan_type,
    })
}

fn newest_rollout(codex_home: &Path) -> Option<PathBuf> {
    let sessions = codex_home.join("sessions");
    let mut newest: Option<(std::time::SystemTime, PathBuf)> = None;
    for entry in walk_jsonl(&sessions) {
        if let Ok(meta) = std::fs::metadata(&entry) {
            if let Ok(mtime) = meta.modified() {
                if newest.as_ref().map(|(t, _)| mtime > *t).unwrap_or(true) {
                    newest = Some((mtime, entry));
                }
            }
        }
    }
    newest.map(|(_, p)| p)
}

fn walk_jsonl(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        if let Ok(rd) = std::fs::read_dir(&dir) {
            for e in rd.flatten() {
                let p = e.path();
                if p.is_dir() {
                    stack.push(p);
                } else if p.extension().map(|x| x == "jsonl").unwrap_or(false) {
                    out.push(p);
                }
            }
        }
    }
    out
}

pub fn latest_rollout_rate_limits(codex_home: &Path) -> Result<String, CodexError> {
    let path = newest_rollout(codex_home).ok_or(CodexError::NoRollout)?;
    let content = std::fs::read_to_string(&path).map_err(|_| CodexError::NoRollout)?;
    // 파일 뒤에서부터 rate_limits를 포함한 마지막 줄 탐색
    for line in content.lines().rev() {
        if let Some(idx) = line.find("\"rate_limits\"") {
            // rate_limits 객체만 잘라내기: 값 시작 '{' 부터 균형 맞는 '}' 까지
            let after = &line[idx..];
            if let Some(brace) = after.find('{') {
                let slice = &after[brace..];
                if let Some(obj) = extract_balanced_object(slice) {
                    return Ok(obj.to_string());
                }
            }
        }
    }
    Err(CodexError::NoRollout)
}

fn extract_balanced_object(s: &str) -> Option<&str> {
    let bytes = s.as_bytes();
    let mut depth = 0usize;
    let mut in_str = false;
    let mut esc = false;
    for (i, &b) in bytes.iter().enumerate() {
        if in_str {
            if esc { esc = false; }
            else if b == b'\\' { esc = true; }
            else if b == b'"' { in_str = false; }
            continue;
        }
        match b {
            b'"' => in_str = true,
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 { return Some(&s[..=i]); }
            }
            _ => {}
        }
    }
    None
}

pub async fn fetch_live(auth: &CodexAuth) -> Result<UsageSnapshot, CodexError> {
    let client = reqwest::Client::builder()
        .user_agent("codex_cli_rs/0.144.3 (token-usage-app)")
        .build()
        .map_err(|e| CodexError::Http(e.to_string()))?;
    let resp = client
        .get("https://chatgpt.com/backend-api/codex/usage")
        .header("Authorization", format!("Bearer {}", auth.access_token))
        .header("chatgpt-account-id", &auth.account_id)
        .header("originator", "codex_cli_rs")
        .header("OpenAI-Beta", "responses=experimental")
        .send()
        .await
        .map_err(|e| CodexError::Http(e.to_string()))?;
    if !resp.status().is_success() {
        return Err(CodexError::Http(format!("status {}", resp.status())));
    }
    let body = resp.text().await.map_err(|e| CodexError::Http(e.to_string()))?;
    let now = chrono::Utc::now().timestamp();
    // 라이브 응답이 rate_limits를 직접 주는지 확인 필요(Task 6 스파이크). 우선 rate_limits 키가 있으면 추출, 없으면 전체를 시도.
    let json = latest_rate_limits_from_body(&body).unwrap_or(body);
    let mut snap = parse_rate_limits(&json, &auth.plan_type, Source::Live, now)?;
    // Spark: 라이브 응답에 spark 관련 필드가 있으면 여기서 채운다(구현 시 실제 키로 교체).
    fill_spark_if_present(&mut snap, &json);
    Ok(snap)
}

fn latest_rate_limits_from_body(body: &str) -> Option<String> {
    let idx = body.find("\"rate_limits\"")?;
    let after = &body[idx..];
    let brace = after.find('{')?;
    extract_balanced_object(&after[brace..]).map(|s| s.to_string())
}

fn fill_spark_if_present(_snap: &mut UsageSnapshot, _json: &str) {
    // TODO(구현 스파이크): 라이브 응답의 Spark 전용 한도 키를 확인 후 매핑.
    // 현재는 unavailable 유지. Task 6에서 실제 응답 확인 뒤 이 함수 구현.
}

pub async fn get() -> Result<UsageSnapshot, CodexError> {
    let home = dirs::home_dir().ok_or(CodexError::NoCredentials)?.join(".codex");
    let auth = read_auth(&home)?;
    match fetch_live(&auth).await {
        Ok(s) => Ok(s),
        Err(_) => {
            let json = latest_rollout_rate_limits(&home)?;
            let plan = if auth.plan_type.is_empty() { String::new() } else { auth.plan_type.clone() };
            parse_rate_limits(&json, &plan, Source::Cache, chrono::Utc::now().timestamp())
        }
    }
}
```

> 참고: 위 `fill_spark_if_present`의 `TODO`는 **Task 6의 라이브 스파이크에서 실제 응답 구조를 확인한 뒤** 구현한다. 이 계획서 내 다른 곳에는 미완성 코드가 없다.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd src-tauri && cargo test codex::tests 2>&1 | tail -15`
Expected: PASS (5 passed).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/providers/codex.rs src-tauri/tests/fixtures/rollout_sample.jsonl
git commit -m "feat(codex): rollout 폴백 리더 + id_token plan + 라이브 fetch/오케스트레이션"
```

---

### Task 6: Codex 라이브 엔드포인트 스파이크 & Spark 매핑 확정

**Files:**
- Modify: `src-tauri/src/providers/codex.rs` (`fetch_live`, `fill_spark_if_present`)

**Interfaces:**
- Consumes/Produces: 기존 `get()`/`fetch_live()` 시그니처 유지.

- [ ] **Step 1: 라이브 응답 실측**

`#[ignore]` 통합 테스트로 실제 응답 원문을 덤프:
```rust
    #[tokio::test]
    #[ignore]
    async fn codex_live_dump() {
        let home = dirs::home_dir().unwrap().join(".codex");
        let auth = read_auth(&home).unwrap();
        let client = reqwest::Client::builder()
            .user_agent("codex_cli_rs/0.144.3 (token-usage-app)").build().unwrap();
        let r = client.get("https://chatgpt.com/backend-api/codex/usage")
            .header("Authorization", format!("Bearer {}", auth.access_token))
            .header("chatgpt-account-id", &auth.account_id)
            .header("originator", "codex_cli_rs")
            .header("OpenAI-Beta", "responses=experimental")
            .send().await.unwrap();
        println!("STATUS={}", r.status());
        println!("BODY={}", r.text().await.unwrap());
    }
```
Run: `cd src-tauri && cargo test codex_live_dump -- --ignored --nocapture 2>&1 | tail -40`

- [ ] **Step 2: 분기 처리**

- **성공(200 + JSON):** 응답에서 5시간/주간/Spark 한도의 실제 키를 확인한다. `fetch_live`의 파싱을 실제 구조에 맞게 교정하고, `fill_spark_if_present`를 실제 Spark 키로 구현한다(예: 응답 내 per-model 배열에서 model 이름이 "Spark"/"gpt-5.3-codex-spark"인 항목의 `resets_at`/`used_percent`를 `CodexSparkWeekly`에 매핑, `available=true`).
- **실패(403/Cloudflare):** `reqwest`로도 통과 못하면, `get()`에서 라이브를 건너뛰고 rollout 폴백을 1차로 쓰도록 순서를 조정한다(주석으로 사유 기록). Spark는 rollout에 없으므로 `available:false` 유지. `docs/superpowers/specs/...`의 §9-1을 실제 결과로 갱신.

- [ ] **Step 3: 회귀 테스트 유지 확인**

Run: `cd src-tauri && cargo test codex::tests 2>&1 | tail -12`
Expected: 기존 파서 테스트 PASS 유지(스파이크가 순수 파서 계약을 깨지 않아야 함).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/providers/codex.rs docs/superpowers/specs/2026-07-14-token-usage-app-design.md
git commit -m "feat(codex): 라이브 usage 응답 실측 반영 + Spark 매핑 확정"
```

---

## Phase 4 — 오케스트레이션 · 설정 · 커맨드

### Task 7: get_usage 오케스트레이션 + 캐시

**Files:**
- Create: `src-tauri/src/usage.rs`
- Modify: `src-tauri/src/lib.rs` (`mod usage;`)
- Test: `src-tauri/src/usage.rs`

**Interfaces:**
- Consumes: `providers::claude::get`, `providers::codex::get`, `model::{UsageSnapshot, ProviderId, Source}`
- Produces:
  - `pub struct UsageReport { pub claude: UsageSnapshot, pub codex: UsageSnapshot }` (serde)
  - `pub async fn collect() -> UsageReport` (두 provider 병렬, 실패는 error 필드 담은 스냅샷으로 격리)
  - `pub fn error_snapshot(provider: ProviderId, msg: String) -> UsageSnapshot`

- [ ] **Step 1: Write the failing test**

`src-tauri/src/usage.rs` 하단:
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{ProviderId, WindowId};

    #[test]
    fn error_snapshot_has_placeholders_and_error() {
        let s = error_snapshot(ProviderId::Codex, "no creds".into());
        assert_eq!(s.provider, ProviderId::Codex);
        assert_eq!(s.error.as_deref(), Some("no creds"));
        // Codex 자리표시 윈도우 3개(5h, weekly, spark) 모두 unavailable
        assert_eq!(s.windows.len(), 3);
        assert!(s.windows.iter().all(|w| !w.available));
        assert!(s.windows.iter().any(|w| w.id == WindowId::CodexSparkWeekly));
    }

    #[test]
    fn error_snapshot_claude_windows() {
        let s = error_snapshot(ProviderId::Claude, "x".into());
        assert_eq!(s.windows.len(), 3);
        assert!(s.windows.iter().any(|w| w.id == WindowId::ClaudeWeeklyFable));
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test usage:: 2>&1 | tail -10`
Expected: FAIL — 미정의.

- [ ] **Step 3: Write minimal implementation**

Create `src-tauri/src/usage.rs`:
```rust
use crate::model::{LimitWindow, ProviderId, Source, UsageSnapshot, WindowId};
use crate::providers::{claude, codex};
use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct UsageReport {
    pub claude: UsageSnapshot,
    pub codex: UsageSnapshot,
}

pub fn error_snapshot(provider: ProviderId, msg: String) -> UsageSnapshot {
    let windows = match provider {
        ProviderId::Claude => vec![
            LimitWindow::unavailable(WindowId::ClaudeSession),
            LimitWindow::unavailable(WindowId::ClaudeWeeklyAll),
            LimitWindow::unavailable(WindowId::ClaudeWeeklyFable),
        ],
        ProviderId::Codex => vec![
            LimitWindow::unavailable(WindowId::CodexFiveHour),
            LimitWindow::unavailable(WindowId::CodexWeekly),
            LimitWindow::unavailable(WindowId::CodexSparkWeekly),
        ],
    };
    UsageSnapshot {
        provider,
        plan: String::new(),
        plan_raw: String::new(),
        source: Source::Cache,
        updated_at: chrono::Utc::now().timestamp(),
        windows,
        error: Some(msg),
    }
}

pub async fn collect() -> UsageReport {
    let (c, x) = tokio::join!(claude::get(), codex::get());
    UsageReport {
        claude: c.unwrap_or_else(|e| error_snapshot(ProviderId::Claude, e.to_string())),
        codex: x.unwrap_or_else(|e| error_snapshot(ProviderId::Codex, e.to_string())),
    }
}
```

`src-tauri/src/lib.rs`에 `mod usage;` 추가.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test usage:: 2>&1 | tail -10`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/usage.rs src-tauri/src/lib.rs
git commit -m "feat(core): get_usage 오케스트레이션 + provider 실패 격리"
```

---

### Task 8: 설정 모델 + 영속화

**Files:**
- Create: `src-tauri/src/settings.rs`
- Modify: `src-tauri/src/lib.rs` (`mod settings;`)
- Test: `src-tauri/src/settings.rs`

**Interfaces:**
- Produces:
  - `pub struct Settings { pub language: String, pub theme: String, pub refresh_interval_secs: u64, pub notify_thresholds: Vec<u8> }` (serde; 기본 `en`/`system`/60/[80,100])
  - `impl Default for Settings`
  - `pub fn sanitize(s: Settings) -> Settings` (간격 하한 15초, 임계치 0~100 클램프/정렬/중복제거)

- [ ] **Step 1: Write the failing test**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_values() {
        let s = Settings::default();
        assert_eq!(s.language, "en");
        assert_eq!(s.theme, "system");
        assert_eq!(s.refresh_interval_secs, 60);
        assert_eq!(s.notify_thresholds, vec![80, 100]);
    }

    #[test]
    fn sanitize_clamps_interval_and_thresholds() {
        let s = sanitize(Settings {
            language: "ko".into(),
            theme: "dark".into(),
            refresh_interval_secs: 3,
            notify_thresholds: vec![100, 80, 80, 150],
        });
        assert_eq!(s.refresh_interval_secs, 15);
        assert_eq!(s.notify_thresholds, vec![80, 100]); // 정렬·중복제거·클램프
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test settings:: 2>&1 | tail -10`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

Create `src-tauri/src/settings.rs`:
```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Settings {
    pub language: String,
    pub theme: String,
    pub refresh_interval_secs: u64,
    pub notify_thresholds: Vec<u8>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            language: "en".into(),
            theme: "system".into(),
            refresh_interval_secs: 60,
            notify_thresholds: vec![80, 100],
        }
    }
}

pub fn sanitize(mut s: Settings) -> Settings {
    if s.refresh_interval_secs < 15 {
        s.refresh_interval_secs = 15;
    }
    let mut t: Vec<u8> = s.notify_thresholds.into_iter().map(|v| v.min(100)).collect();
    t.sort_unstable();
    t.dedup();
    s.notify_thresholds = t;
    if !matches!(s.theme.as_str(), "light" | "dark" | "system") {
        s.theme = "system".into();
    }
    if !matches!(s.language.as_str(), "en" | "ko") {
        s.language = "en".into();
    }
    s
}
```

`lib.rs`에 `mod settings;` 추가.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test settings:: 2>&1 | tail -10`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/settings.rs src-tauri/src/lib.rs
git commit -m "feat(core): 설정 모델 + sanitize"
```

---

### Task 9: Tauri command 등록 (get_usage / get_settings / set_settings)

**Files:**
- Create: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs` (command 등록, plugin 등록)
- Test: 수동 스모크(프론트에서 호출) — Task 15에서 통합 확인

**Interfaces:**
- Consumes: `usage::collect`, `settings::{Settings, sanitize}`, `tauri-plugin-store`
- Produces:
  - `#[tauri::command] async fn get_usage() -> UsageReport`
  - `#[tauri::command] fn get_settings(app) -> Settings`
  - `#[tauri::command] fn set_settings(app, settings: Settings) -> Settings`
  - store 키: 파일 `settings.json`, 키 `"settings"`.

- [ ] **Step 1: Write implementation**

Create `src-tauri/src/commands.rs`:
```rust
use crate::settings::{sanitize, Settings};
use crate::usage::{self, UsageReport};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "settings.json";
const KEY: &str = "settings";

#[tauri::command]
pub async fn get_usage() -> UsageReport {
    usage::collect().await
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Settings {
    let store = app.store(STORE_FILE).expect("store");
    match store.get(KEY) {
        Some(v) => serde_json::from_value(v).map(sanitize).unwrap_or_default(),
        None => Settings::default(),
    }
}

#[tauri::command]
pub fn set_settings(app: AppHandle, settings: Settings) -> Settings {
    let clean = sanitize(settings);
    let store = app.store(STORE_FILE).expect("store");
    store.set(KEY, serde_json::to_value(&clean).unwrap());
    let _ = store.save();
    clean
}
```

- [ ] **Step 2: lib.rs 배선**

`src-tauri/src/lib.rs`의 `run()`을 다음처럼 구성(기존 템플릿 대체):
```rust
mod model;
mod providers;
mod usage;
mod settings;
mod commands;
mod poller;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_usage,
            commands::get_settings,
            commands::set_settings,
        ])
        .setup(|app| {
            poller::start(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```
(`poller` 모듈은 Task 10에서 구현; 이 배선은 Task 10 완료 후 컴파일된다. 임시로 Task 10 전이라면 `.setup(...)` 라인을 주석 처리하고 진행하되, 커밋은 Task 10 이후에.)

- [ ] **Step 3: 권한 설정**

`src-tauri/capabilities/default.json`의 `permissions`에 추가:
```json
"store:default",
"notification:default"
```

- [ ] **Step 4: 컴파일 확인 (poller 스텁 포함)**

임시 스텁 `src-tauri/src/poller.rs`:
```rust
use tauri::AppHandle;
pub fn start(_app: AppHandle) {}
```
Run: `cd src-tauri && cargo build 2>&1 | tail -15`
Expected: 성공.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs src-tauri/src/poller.rs src-tauri/capabilities/default.json
git commit -m "feat(core): Tauri command(get_usage/get/set_settings) + plugin 배선"
```

---

### Task 10: 폴러 + usage-updated 이벤트 + 임계치 알림

**Files:**
- Modify: `src-tauri/src/poller.rs`
- Test: `src-tauri/src/poller.rs` (임계치 교차 판정 순수 함수 단위 테스트)

**Interfaces:**
- Consumes: `usage::{collect, UsageReport}`, `settings`, `tauri::Emitter`, `tauri-plugin-notification`
- Produces:
  - `pub fn start(app: AppHandle)` — tokio 태스크로 interval 폴링, 매 회 `usage-updated` emit + 알림 판정
  - `pub fn crossed_thresholds(prev: Option<f64>, now: f64, thresholds: &[u8]) -> Vec<u8>` (순수, 테스트 대상)

- [ ] **Step 1: Write the failing test**

`poller.rs` 하단:
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_upward_crossing() {
        assert_eq!(crossed_thresholds(Some(75.0), 82.0, &[80, 100]), vec![80]);
    }
    #[test]
    fn no_crossing_when_below() {
        assert_eq!(crossed_thresholds(Some(50.0), 60.0, &[80, 100]), Vec::<u8>::new());
    }
    #[test]
    fn first_reading_above_threshold_fires() {
        assert_eq!(crossed_thresholds(None, 100.0, &[80, 100]), vec![80, 100]);
    }
    #[test]
    fn no_refire_when_already_above() {
        assert_eq!(crossed_thresholds(Some(85.0), 90.0, &[80, 100]), Vec::<u8>::new());
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test poller:: 2>&1 | tail -10`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

`poller.rs` 전체 교체:
```rust
use crate::settings::Settings;
use crate::usage;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_store::StoreExt;

pub fn crossed_thresholds(prev: Option<f64>, now: f64, thresholds: &[u8]) -> Vec<u8> {
    thresholds
        .iter()
        .copied()
        .filter(|&t| now >= t as f64 && prev.map(|p| p < t as f64).unwrap_or(true))
        .collect()
}

fn load_settings(app: &AppHandle) -> Settings {
    let store = match app.store("settings.json") {
        Ok(s) => s,
        Err(_) => return Settings::default(),
    };
    store
        .get("settings")
        .and_then(|v| serde_json::from_value(v).ok())
        .map(crate::settings::sanitize)
        .unwrap_or_default()
}

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // 윈도우별 직전 퍼센트 기억 (id 문자열 → percent)
        let last: Mutex<HashMap<String, f64>> = Mutex::new(HashMap::new());
        loop {
            let settings = load_settings(&app);
            let report = usage::collect().await;
            let _ = app.emit("usage-updated", &report);

            // 알림 판정
            for snap in [&report.claude, &report.codex] {
                for w in &snap.windows {
                    if !w.available {
                        continue;
                    }
                    let key = format!("{:?}", w.id);
                    let prev = last.lock().unwrap().get(&key).copied();
                    let fired = crossed_thresholds(prev, w.used_percent, &settings.notify_thresholds);
                    for t in fired {
                        let _ = app
                            .notification()
                            .builder()
                            .title("Token Usage")
                            .body(format!("{:?} reached {}%", w.id, t))
                            .show();
                    }
                    last.lock().unwrap().insert(key, w.used_percent);
                }
            }

            tokio::time::sleep(std::time::Duration::from_secs(settings.refresh_interval_secs)).await;
        }
    });
}
```

- [ ] **Step 4: Run test + build**

Run: `cd src-tauri && cargo test poller:: 2>&1 | tail -10 && cargo build 2>&1 | tail -8`
Expected: 테스트 PASS(4), 빌드 성공.

- [ ] **Step 5: lib.rs `.setup` 활성화 확인**

Task 9에서 주석 처리했다면 `poller::start(...)` 활성화 후 `cargo build`.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/poller.rs src-tauri/src/lib.rs
git commit -m "feat(core): 폴러 + usage-updated 이벤트 + 임계치 교차 알림"
```

---

### Task 11: 트레이 아이콘 + 창 토글 + 포커스 새로고침

**Files:**
- Modify: `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json`
- Test: 수동 스모크

**Interfaces:**
- Consumes: `tauri::tray`, 기존 poller/emit
- Produces: 트레이 아이콘(좌클릭 창 토글), 창 포커스 시 `usage-updated` 1회 즉시 방출.

- [ ] **Step 1: 트레이 구성**

`lib.rs`의 `.setup` 안에 추가:
```rust
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, WindowEvent};

let _tray = TrayIconBuilder::new()
    .icon(app.default_window_icon().unwrap().clone())
    .on_tray_icon_event(|tray, event| {
        if let tauri::tray::TrayIconEvent::Click { .. } = event {
            if let Some(win) = tray.app_handle().get_webview_window("main") {
                let _ = if win.is_visible().unwrap_or(false) { win.hide() } else { win.show().and_then(|_| win.set_focus()) };
            }
        }
    })
    .build(app)?;
```

- [ ] **Step 2: 포커스 새로고침**

`.setup`에서 메인 창에 이벤트 훅:
```rust
if let Some(win) = app.get_webview_window("main") {
    let handle = app.handle().clone();
    win.on_window_event(move |e| {
        if let WindowEvent::Focused(true) = e {
            let h = handle.clone();
            tauri::async_runtime::spawn(async move {
                let report = crate::usage::collect().await;
                let _ = h.emit("usage-updated", &report);
            });
        }
    });
}
```
(`use tauri::Emitter;`가 상단에 있어야 함.)

- [ ] **Step 3: 빌드 확인**

Run: `cd src-tauri && cargo build 2>&1 | tail -10`
Expected: 성공.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/tauri.conf.json
git commit -m "feat(core): 트레이 아이콘 창 토글 + 포커스 시 새로고침"
```

---

## Phase 5 — 프론트엔드

### Task 12: 타입 미러 + invoke 래퍼

**Files:**
- Create: `src/lib/types.ts`, `src/lib/usage.ts`, `src/lib/settings.ts`, `src/lib/format.ts`
- Test: `src/lib/format.test.ts`

**Interfaces:**
- Produces:
  - `types.ts`: `WindowId`, `LimitWindow`, `UsageSnapshot`, `UsageReport`, `Settings` (백엔드 serde 출력과 정확히 일치하는 필드/케이스)
  - `usage.ts`: `fetchUsage(): Promise<UsageReport>`, `onUsageUpdated(cb): Promise<UnlistenFn>`
  - `settings.ts`: `getSettings()`, `setSettings(s)`
  - `format.ts`: `formatCountdown(resetsAtEpoch: number, now: number, locale: "en"|"ko"): string`

- [ ] **Step 1: Write the failing test**

Create `src/lib/format.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { formatCountdown } from "./format";

describe("formatCountdown", () => {
  it("formats hours and minutes in English", () => {
    const now = 1_000_000;
    const reset = now + 2 * 3600 + 30 * 60; // 2h30m
    expect(formatCountdown(reset, now, "en")).toBe("resets in 2h 30m");
  });
  it("formats in Korean", () => {
    const now = 1_000_000;
    const reset = now + 3600; // 1h
    expect(formatCountdown(reset, now, "ko")).toBe("1시간 0분 후 리셋");
  });
  it("shows resetting when past", () => {
    expect(formatCountdown(500, 1000, "en")).toBe("resetting…");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- format 2>&1 | tail -12`
Expected: FAIL — `formatCountdown` 없음.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/types.ts`:
```ts
export type WindowId =
  | "claude_session"
  | "claude_weekly_all"
  | "claude_weekly_fable"
  | "codex_five_hour"
  | "codex_weekly"
  | "codex_spark_weekly";

export interface LimitWindow {
  id: WindowId;
  used_percent: number;
  resets_at: number | null;
  available: boolean;
}

export interface UsageSnapshot {
  provider: "claude" | "codex";
  plan: string;
  plan_raw: string;
  source: "live" | "cache";
  updated_at: number;
  windows: LimitWindow[];
  error: string | null;
}

export interface UsageReport {
  claude: UsageSnapshot;
  codex: UsageSnapshot;
}

export interface Settings {
  language: "en" | "ko";
  theme: "light" | "dark" | "system";
  refresh_interval_secs: number;
  notify_thresholds: number[];
}
```

Create `src/lib/usage.ts`:
```ts
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { UsageReport } from "./types";

export function fetchUsage(): Promise<UsageReport> {
  return invoke<UsageReport>("get_usage");
}

export function onUsageUpdated(cb: (r: UsageReport) => void): Promise<UnlistenFn> {
  return listen<UsageReport>("usage-updated", (e) => cb(e.payload));
}
```

Create `src/lib/settings.ts`:
```ts
import { invoke } from "@tauri-apps/api/core";
import type { Settings } from "./types";

export function getSettings(): Promise<Settings> {
  return invoke<Settings>("get_settings");
}
export function setSettings(settings: Settings): Promise<Settings> {
  return invoke<Settings>("set_settings", { settings });
}
```

Create `src/lib/format.ts`:
```ts
export function formatCountdown(
  resetsAtEpoch: number,
  now: number,
  locale: "en" | "ko"
): string {
  const diff = resetsAtEpoch - now;
  if (diff <= 0) return locale === "ko" ? "리셋 중…" : "resetting…";
  const totalMin = Math.floor(diff / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (locale === "ko") {
    return h > 0 ? `${h}시간 ${m}분 후 리셋` : `${m}분 후 리셋`;
  }
  return h > 0 ? `resets in ${h}h ${m}m` : `resets in ${m}m`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- format 2>&1 | tail -10`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add src/lib
git commit -m "feat(ui): 타입 미러 + invoke 래퍼 + 카운트다운 포맷"
```

---

### Task 13: i18n + 테마 CSS

**Files:**
- Create: `src/i18n.ts`, `src/locales/en.json`, `src/locales/ko.json`, `src/theme.ts`, `src/styles/theme.css`
- Test: `src/i18n.test.ts`

**Interfaces:**
- Produces:
  - `i18n.ts`: 초기화된 i18next 인스턴스(default export), 키 존재.
  - `theme.ts`: `applyTheme(theme: "light"|"dark"|"system"): void` (문서 루트 `data-theme` 설정, system은 matchMedia)
  - `theme.css`: `:root` 라이트 토큰, `[data-theme="dark"]` 다크 토큰, `.provider-claude { --accent:#D97757 }`, `.provider-codex { --accent:#5162ED }`

- [ ] **Step 1: Write the failing test**

Create `src/i18n.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import i18n from "./i18n";

describe("i18n", () => {
  it("has english label for claude session", () => {
    expect(i18n.getFixedT("en")("window.claude_session")).toBe("Current session");
  });
  it("has korean label for codex weekly", () => {
    expect(i18n.getFixedT("ko")("window.codex_weekly")).toBe("주간 한도");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- i18n 2>&1 | tail -10`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

Create `src/locales/en.json`:
```json
{
  "app": { "title": "Token Usage", "refresh": "Refresh", "settings": "Settings", "lastUpdated": "Updated {{time}}", "cached": "cached" },
  "provider": { "claude": "Claude", "codex": "Codex", "plan": "Plan", "connect": "Sign in with the {{name}} CLI to see usage", "unavailable": "No data" },
  "window": {
    "claude_session": "Current session",
    "claude_weekly_all": "Current week (all models)",
    "claude_weekly_fable": "Current week (Fable)",
    "codex_five_hour": "Current 5-hour",
    "codex_weekly": "Weekly limit",
    "codex_spark_weekly": "Spark weekly limit"
  },
  "settings": { "language": "Language", "theme": "Theme", "light": "Light", "dark": "Dark", "system": "System", "interval": "Auto-refresh (seconds)", "thresholds": "Notify at (%)" }
}
```

Create `src/locales/ko.json`:
```json
{
  "app": { "title": "토큰 사용량", "refresh": "새로고침", "settings": "설정", "lastUpdated": "{{time}} 갱신", "cached": "캐시됨" },
  "provider": { "claude": "Claude", "codex": "Codex", "plan": "플랜", "connect": "{{name}} CLI로 로그인하면 사용량이 보여요", "unavailable": "데이터 없음" },
  "window": {
    "claude_session": "현재 세션",
    "claude_weekly_all": "이번 주 (전체 모델)",
    "claude_weekly_fable": "이번 주 (Fable)",
    "codex_five_hour": "현재 5시간",
    "codex_weekly": "주간 한도",
    "codex_spark_weekly": "Spark 주간 한도"
  },
  "settings": { "language": "언어", "theme": "테마", "light": "라이트", "dark": "다크", "system": "시스템", "interval": "자동 새로고침 (초)", "thresholds": "알림 임계치 (%)" }
}
```

Create `src/i18n.ts`:
```ts
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import ko from "./locales/ko.json";

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ko: { translation: ko } },
  lng: "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
```

Create `src/theme.ts`:
```ts
export function applyTheme(theme: "light" | "dark" | "system"): void {
  const root = document.documentElement;
  if (theme === "system") {
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.setAttribute("data-theme", dark ? "dark" : "light");
  } else {
    root.setAttribute("data-theme", theme);
  }
}
```

Create `src/styles/theme.css`:
```css
:root, [data-theme="light"] {
  --bg: #f7f7f8;
  --card: #ffffff;
  --text: #1a1a1a;
  --muted: #6b6b6b;
  --track: #e6e6e6;
  --border: #e0e0e0;
}
[data-theme="dark"] {
  --bg: #1b1b1d;
  --card: #262629;
  --text: #f2f2f2;
  --muted: #a0a0a0;
  --track: #3a3a3d;
  --border: #38383b;
}
.provider-claude { --accent: #D97757; }
.provider-codex  { --accent: #5162ED; }

body { margin: 0; background: var(--bg); color: var(--text); font-family: system-ui, -apple-system, sans-serif; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- i18n 2>&1 | tail -10`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add src/i18n.ts src/locales src/theme.ts src/styles/theme.css src/i18n.test.ts
git commit -m "feat(ui): i18n(EN/KO) + 테마 CSS 변수 + provider 강조색"
```

---

### Task 14: LimitBar 컴포넌트

**Files:**
- Create: `src/components/LimitBar.tsx`
- Test: `src/components/LimitBar.test.tsx`

**Interfaces:**
- Consumes: `types.LimitWindow`, `i18n`, `format.formatCountdown`
- Produces: `export function LimitBar({ window, now, locale }: { window: LimitWindow; now: number; locale: "en"|"ko" })`
  - 라벨(i18n `window.<id>`), 채움 폭 = `used_percent%`, 퍼센트 텍스트, 카운트다운.
  - `available=false`면 흐린 상태 + "데이터 없음", 바 0%.

- [ ] **Step 1: Write the failing test**

Create `src/components/LimitBar.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "../i18n";
import { LimitBar } from "./LimitBar";

const wrap = (ui: React.ReactNode) => <I18nextProvider i18n={i18n}>{ui}</I18nextProvider>;

describe("LimitBar", () => {
  it("renders label, percent, and fill width", () => {
    render(wrap(<LimitBar window={{ id: "claude_session", used_percent: 42, resets_at: 2000, available: true }} now={1000} locale="en" />));
    expect(screen.getByText("Current session")).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
    const fill = screen.getByTestId("bar-fill");
    expect(fill).toHaveStyle({ width: "42%" });
  });

  it("shows unavailable state", () => {
    render(wrap(<LimitBar window={{ id: "codex_spark_weekly", used_percent: 0, resets_at: null, available: false }} now={0} locale="en" />));
    expect(screen.getByText("No data")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- LimitBar 2>&1 | tail -12`
Expected: FAIL — 컴포넌트 없음.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/LimitBar.tsx`:
```tsx
import { useTranslation } from "react-i18next";
import type { LimitWindow } from "../lib/types";
import { formatCountdown } from "../lib/format";

export function LimitBar({
  window,
  now,
  locale,
}: {
  window: LimitWindow;
  now: number;
  locale: "en" | "ko";
}) {
  const { t } = useTranslation();
  const label = t(`window.${window.id}`);
  const pct = Math.max(0, Math.min(100, window.used_percent));

  if (!window.available) {
    return (
      <div className="limit-bar limit-bar--unavailable">
        <div className="limit-bar__row">
          <span className="limit-bar__label">{label}</span>
          <span className="limit-bar__muted">{t("provider.unavailable")}</span>
        </div>
        <div className="limit-bar__track"><div data-testid="bar-fill" className="limit-bar__fill" style={{ width: "0%" }} /></div>
      </div>
    );
  }

  return (
    <div className="limit-bar">
      <div className="limit-bar__row">
        <span className="limit-bar__label">{label}</span>
        <span className="limit-bar__pct">{Math.round(pct)}%</span>
      </div>
      <div className="limit-bar__track">
        <div data-testid="bar-fill" className="limit-bar__fill" style={{ width: `${pct}%`, background: "var(--accent)" }} />
      </div>
      {window.resets_at != null && (
        <div className="limit-bar__reset">{formatCountdown(window.resets_at, now, locale)}</div>
      )}
    </div>
  );
}
```

`src/styles/theme.css`에 바 스타일 추가:
```css
.limit-bar { margin: 10px 0; }
.limit-bar__row { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 4px; }
.limit-bar__label { font-weight: 500; }
.limit-bar__pct { color: var(--accent); font-variant-numeric: tabular-nums; }
.limit-bar__muted { color: var(--muted); }
.limit-bar__track { height: 8px; background: var(--track); border-radius: 999px; overflow: hidden; }
.limit-bar__fill { height: 100%; border-radius: 999px; transition: width .3s ease; }
.limit-bar__reset { font-size: 11px; color: var(--muted); margin-top: 3px; }
.limit-bar--unavailable { opacity: .5; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- LimitBar 2>&1 | tail -10`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add src/components/LimitBar.tsx src/components/LimitBar.test.tsx src/styles/theme.css
git commit -m "feat(ui): LimitBar 컴포넌트 + 테스트"
```

---

### Task 15: ProviderCard + EmptyState

**Files:**
- Create: `src/components/ProviderCard.tsx`, `src/components/EmptyState.tsx`
- Test: `src/components/ProviderCard.test.tsx`

**Interfaces:**
- Consumes: `types.UsageSnapshot`, `LimitBar`, `EmptyState`
- Produces: `export function ProviderCard({ snapshot, now, locale }: { snapshot: UsageSnapshot; now: number; locale: "en"|"ko" })`
  - `provider-claude`/`provider-codex` 클래스로 `--accent` 스코프.
  - `error`가 있으면 `EmptyState`(connect 안내), 아니면 플랜 배지 + 윈도우별 `LimitBar`.
  - `source==="cache"`면 "캐시됨" 배지.

- [ ] **Step 1: Write the failing test**

Create `src/components/ProviderCard.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "../i18n";
import { ProviderCard } from "./ProviderCard";
import type { UsageSnapshot } from "../lib/types";

const wrap = (ui: React.ReactNode) => <I18nextProvider i18n={i18n}>{ui}</I18nextProvider>;

const base: UsageSnapshot = {
  provider: "claude", plan: "Max 20x", plan_raw: "max", source: "live", updated_at: 0,
  windows: [{ id: "claude_session", used_percent: 10, resets_at: 100, available: true }], error: null,
};

describe("ProviderCard", () => {
  it("shows plan and applies accent class", () => {
    const { container } = render(wrap(<ProviderCard snapshot={base} now={0} locale="en" />));
    expect(screen.getByText("Max 20x")).toBeInTheDocument();
    expect(container.querySelector(".provider-claude")).toBeTruthy();
  });

  it("shows connect state on error", () => {
    render(wrap(<ProviderCard snapshot={{ ...base, error: "no creds" }} now={0} locale="en" />));
    expect(screen.getByText(/Sign in with the Claude CLI/)).toBeInTheDocument();
  });

  it("shows cached badge", () => {
    render(wrap(<ProviderCard snapshot={{ ...base, source: "cache" }} now={0} locale="en" />));
    expect(screen.getByText("cached")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- ProviderCard 2>&1 | tail -12`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/EmptyState.tsx`:
```tsx
import { useTranslation } from "react-i18next";

export function EmptyState({ providerName }: { providerName: string }) {
  const { t } = useTranslation();
  return <div className="empty-state">{t("provider.connect", { name: providerName })}</div>;
}
```

Create `src/components/ProviderCard.tsx`:
```tsx
import { useTranslation } from "react-i18next";
import type { UsageSnapshot } from "../lib/types";
import { LimitBar } from "./LimitBar";
import { EmptyState } from "./EmptyState";

export function ProviderCard({
  snapshot,
  now,
  locale,
}: {
  snapshot: UsageSnapshot;
  now: number;
  locale: "en" | "ko";
}) {
  const { t } = useTranslation();
  const providerName = t(`provider.${snapshot.provider}`);
  const cls = snapshot.provider === "claude" ? "provider-claude" : "provider-codex";

  return (
    <section className={`provider-card ${cls}`}>
      <header className="provider-card__head">
        <h2 className="provider-card__name">{providerName}</h2>
        {!snapshot.error && (
          <span className="provider-card__plan" style={{ background: "var(--accent)" }}>
            {snapshot.plan}
          </span>
        )}
        {snapshot.source === "cache" && !snapshot.error && (
          <span className="provider-card__cached">{t("app.cached")}</span>
        )}
      </header>
      {snapshot.error ? (
        <EmptyState providerName={providerName} />
      ) : (
        <div className="provider-card__bars">
          {snapshot.windows.map((w) => (
            <LimitBar key={w.id} window={w} now={now} locale={locale} />
          ))}
        </div>
      )}
    </section>
  );
}
```

`theme.css`에 추가:
```css
.provider-card { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 16px 18px; }
.provider-card__head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.provider-card__name { font-size: 16px; margin: 0; }
.provider-card__plan { color: #fff; font-size: 11px; padding: 2px 8px; border-radius: 999px; }
.provider-card__cached { font-size: 11px; color: var(--muted); border: 1px solid var(--border); padding: 1px 6px; border-radius: 999px; }
.empty-state { color: var(--muted); font-size: 13px; padding: 12px 0; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- ProviderCard 2>&1 | tail -10`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add src/components/ProviderCard.tsx src/components/EmptyState.tsx src/components/ProviderCard.test.tsx src/styles/theme.css
git commit -m "feat(ui): ProviderCard + EmptyState"
```

---

### Task 16: SettingsPanel + Header

**Files:**
- Create: `src/components/SettingsPanel.tsx`, `src/components/Header.tsx`
- Test: `src/components/SettingsPanel.test.tsx`

**Interfaces:**
- Consumes: `types.Settings`, i18n
- Produces:
  - `Header({ onRefresh, onOpenSettings, updatedAt, locale })`
  - `SettingsPanel({ settings, onChange, onClose })` — 언어/테마/간격/임계치 편집, `onChange(next: Settings)` 호출.

- [ ] **Step 1: Write the failing test**

Create `src/components/SettingsPanel.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "../i18n";
import { SettingsPanel } from "./SettingsPanel";
import type { Settings } from "../lib/types";

const wrap = (ui: React.ReactNode) => <I18nextProvider i18n={i18n}>{ui}</I18nextProvider>;
const s: Settings = { language: "en", theme: "system", refresh_interval_secs: 60, notify_thresholds: [80, 100] };

describe("SettingsPanel", () => {
  it("emits language change", () => {
    const onChange = vi.fn();
    render(wrap(<SettingsPanel settings={s} onChange={onChange} onClose={() => {}} />));
    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "ko" } });
    expect(onChange).toHaveBeenCalledWith({ ...s, language: "ko" });
  });

  it("emits theme change", () => {
    const onChange = vi.fn();
    render(wrap(<SettingsPanel settings={s} onChange={onChange} onClose={() => {}} />));
    fireEvent.change(screen.getByLabelText("Theme"), { target: { value: "dark" } });
    expect(onChange).toHaveBeenCalledWith({ ...s, theme: "dark" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- SettingsPanel 2>&1 | tail -12`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/SettingsPanel.tsx`:
```tsx
import { useTranslation } from "react-i18next";
import type { Settings } from "../lib/types";

export function SettingsPanel({
  settings,
  onChange,
  onClose,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="settings-panel">
      <label>
        {t("settings.language")}
        <select
          aria-label={t("settings.language")}
          value={settings.language}
          onChange={(e) => onChange({ ...settings, language: e.target.value as Settings["language"] })}
        >
          <option value="en">English</option>
          <option value="ko">한국어</option>
        </select>
      </label>
      <label>
        {t("settings.theme")}
        <select
          aria-label={t("settings.theme")}
          value={settings.theme}
          onChange={(e) => onChange({ ...settings, theme: e.target.value as Settings["theme"] })}
        >
          <option value="light">{t("settings.light")}</option>
          <option value="dark">{t("settings.dark")}</option>
          <option value="system">{t("settings.system")}</option>
        </select>
      </label>
      <label>
        {t("settings.interval")}
        <input
          aria-label={t("settings.interval")}
          type="number"
          min={15}
          value={settings.refresh_interval_secs}
          onChange={(e) => onChange({ ...settings, refresh_interval_secs: Number(e.target.value) })}
        />
      </label>
      <button onClick={onClose}>×</button>
    </div>
  );
}
```

Create `src/components/Header.tsx`:
```tsx
import { useTranslation } from "react-i18next";

export function Header({
  onRefresh,
  onOpenSettings,
  updatedAt,
  locale,
}: {
  onRefresh: () => void;
  onOpenSettings: () => void;
  updatedAt: number | null;
  locale: "en" | "ko";
}) {
  const { t } = useTranslation();
  const timeStr = updatedAt
    ? new Date(updatedAt * 1000).toLocaleTimeString(locale === "ko" ? "ko-KR" : "en-US")
    : "—";
  return (
    <header className="app-header">
      <h1 className="app-header__title">{t("app.title")}</h1>
      <div className="app-header__actions">
        <span className="app-header__updated">{t("app.lastUpdated", { time: timeStr })}</span>
        <button onClick={onRefresh}>{t("app.refresh")}</button>
        <button onClick={onOpenSettings} aria-label={t("app.settings")}>⚙</button>
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- SettingsPanel 2>&1 | tail -10`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add src/components/SettingsPanel.tsx src/components/Header.tsx src/components/SettingsPanel.test.tsx
git commit -m "feat(ui): SettingsPanel + Header"
```

---

### Task 17: App 배선 (상태·이벤트·테마·언어)

**Files:**
- Modify: `src/App.tsx`, `src/main.tsx`
- Test: `src/App.test.tsx`

**Interfaces:**
- Consumes: 모든 컴포넌트, `fetchUsage`, `onUsageUpdated`, `getSettings`, `setSettings`, `applyTheme`, `i18n`
- Produces: 완성된 대시보드. 초기 `getSettings`+`fetchUsage`, `usage-updated` 구독, 설정 변경 시 저장·테마/언어 적용, 1초 틱으로 카운트다운 갱신.

- [ ] **Step 1: Write the failing test (invoke/event 모킹)**

Create `src/App.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { UsageReport, Settings } from "./lib/types";

const report: UsageReport = {
  claude: { provider: "claude", plan: "Max 20x", plan_raw: "max", source: "live", updated_at: 10, windows: [{ id: "claude_session", used_percent: 5, resets_at: 999999999, available: true }], error: null },
  codex: { provider: "codex", plan: "Pro", plan_raw: "pro", source: "live", updated_at: 10, windows: [{ id: "codex_weekly", used_percent: 11, resets_at: 999999999, available: true }], error: null },
};
const settings: Settings = { language: "en", theme: "light", refresh_interval_secs: 60, notify_thresholds: [80, 100] };

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_usage") return Promise.resolve(report);
    if (cmd === "get_settings") return Promise.resolve(settings);
    if (cmd === "set_settings") return Promise.resolve(settings);
    return Promise.resolve(null);
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));

import App from "./App";

describe("App", () => {
  beforeEach(() => vi.clearAllMocks());
  it("renders both provider cards with plans", async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("Max 20x")).toBeInTheDocument();
      expect(screen.getByText("Pro")).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- App 2>&1 | tail -12`
Expected: FAIL (App 내용 기본 템플릿).

- [ ] **Step 3: Write minimal implementation**

Replace `src/App.tsx`:
```tsx
import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { fetchUsage, onUsageUpdated } from "./lib/usage";
import { getSettings, setSettings } from "./lib/settings";
import { applyTheme } from "./theme";
import type { UsageReport, Settings } from "./lib/types";
import { Header } from "./components/Header";
import { ProviderCard } from "./components/ProviderCard";
import { SettingsPanel } from "./components/SettingsPanel";
import "./styles/theme.css";

export default function App() {
  const { i18n } = useTranslation();
  const [report, setReport] = useState<UsageReport | null>(null);
  const [settings, setSettingsState] = useState<Settings | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [showSettings, setShowSettings] = useState(false);

  // 초기 로드
  useEffect(() => {
    getSettings().then((s) => {
      setSettingsState(s);
      applyTheme(s.theme);
      i18n.changeLanguage(s.language);
    });
    fetchUsage().then(setReport);
    const un = onUsageUpdated(setReport);
    return () => { un.then((f) => f()); };
  }, [i18n]);

  // 카운트다운 틱
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const refresh = useCallback(() => { fetchUsage().then(setReport); }, []);

  const changeSettings = useCallback((next: Settings) => {
    setSettingsState(next);
    applyTheme(next.theme);
    i18n.changeLanguage(next.language);
    setSettings(next).then(setSettingsState);
  }, [i18n]);

  const locale = (settings?.language ?? "en") as "en" | "ko";

  return (
    <main className="app">
      <Header
        onRefresh={refresh}
        onOpenSettings={() => setShowSettings((v) => !v)}
        updatedAt={report?.claude.updated_at ?? null}
        locale={locale}
      />
      {showSettings && settings && (
        <SettingsPanel settings={settings} onChange={changeSettings} onClose={() => setShowSettings(false)} />
      )}
      {report && (
        <div className="app__cards">
          <ProviderCard snapshot={report.claude} now={now} locale={locale} />
          <ProviderCard snapshot={report.codex} now={now} locale={locale} />
        </div>
      )}
    </main>
  );
}
```

Replace `src/main.tsx`:
```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import "./i18n";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

`theme.css`에 레이아웃 추가:
```css
.app { max-width: 520px; margin: 0 auto; padding: 16px; }
.app-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
.app-header__title { font-size: 18px; margin: 0; }
.app-header__actions { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.app-header__updated { color: var(--muted); }
.app__cards { display: flex; flex-direction: column; gap: 14px; }
.settings-panel { display: flex; flex-wrap: wrap; gap: 12px; background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 12px; margin-bottom: 14px; }
.settings-panel label { display: flex; flex-direction: column; font-size: 12px; gap: 4px; color: var(--muted); }
button { cursor: pointer; background: var(--card); color: var(--text); border: 1px solid var(--border); border-radius: 8px; padding: 4px 10px; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- App 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: 전체 프론트 테스트**

Run: `npm test 2>&1 | tail -15`
Expected: 모든 스위트 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/main.tsx src/styles/theme.css src/App.test.tsx
git commit -m "feat(ui): App 배선(상태·이벤트·테마·언어) + 대시보드 완성"
```

---

## Phase 6 — 통합 검증

### Task 18: 실앱 구동 검증 (verify 스킬)

**Files:** 없음(검증 전용)

- [ ] **Step 1: 전체 테스트**

Run:
```bash
cd src-tauri && cargo test 2>&1 | tail -15 && cd ..
npm test 2>&1 | tail -15
```
Expected: Rust/프론트 전 테스트 PASS.

- [ ] **Step 2: 개발 모드 구동**

Run: `npm run tauri dev` (백그라운드). 창이 뜨면 확인:
- Claude 카드: 플랜 배지 + 세션/주간(전체)/주간(Fable) 3개 바, 퍼센트·리셋 카운트다운 표시.
- Codex 카드: 플랜 배지 + 5시간/주간/Spark 3개 바(Spark는 라이브 결과에 따라 값 또는 "데이터 없음").
- 강조색: Claude `#D97757`, Codex `#5162ED`.
- 설정에서 언어 EN↔KO, 테마 Light/Dark/System 전환 즉시 반영.
- 트레이 아이콘 클릭 시 창 토글.

- [ ] **Step 3: verify 스킬로 최종 확인**

`verify` 스킬을 사용해 변경이 실제 앱에서 동작하는지 종단 확인. 실패 시 systematic-debugging.

- [ ] **Step 4: Commit (필요 시 수정 반영)**

```bash
git add -A && git commit -m "chore: 통합 검증 및 마감 수정"
```

---

## 자체 검토 결과

- **스펙 커버리지:** Claude(플랜·세션·주간전체·주간Fable) → Task 2/3. Codex(플랜·주간·Spark·5시간보너스) → Task 4/5/6. 다크/라이트/시스템 → Task 13/17. EN/KO → Task 13/16/17. 막대 바 UI → Task 14. 트레이+자동새로고침 → Task 10/11. 알림 → Task 10. 수동/자동 새로고침 → Task 10/11/16/17. 인앱 언어·테마 토글 → Task 16/17. 실패 격리 → Task 7. 라이브+폴백 → Task 5/6.
- **플레이스홀더:** `codex.rs`의 `fill_spark_if_present`만 의도적 후속 지점이며 Task 6에서 실측 후 확정하도록 명시(계획 내 유일한 미확정, 사유·해결 위치 기재). 그 외 미완성 코드 없음.
- **타입 일관성:** `WindowId` snake_case 6종이 Rust(model.rs)·TS(types.ts)·i18n 키·error_snapshot·컴포넌트에서 동일하게 사용됨. `UsageSnapshot`/`Settings` 필드명(serde/TS) 일치 확인.

## 열린 확인 항목 (구현 중 해결 — 스펙 §9와 동일)

1. Codex 라이브 `/usage`가 `reqwest`로 Cloudflare 통과 여부 → Task 6.
2. Spark 주간 한도의 라이브 응답 위치/키 → Task 6.
3. Claude `limits[]`의 다른 scoped 한도 → Fable만 선택(무시), Task 2에서 처리됨.
