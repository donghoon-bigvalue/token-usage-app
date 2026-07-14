use crate::model::{iso8601_to_epoch, year_month_of, LimitWindow, ProviderId, Source, UsageRecord, UsageSnapshot, WindowId};
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use thiserror::Error;
use tokio::sync::Mutex;

/// Public OAuth client id used by the Claude Code CLI. The refresh endpoint
/// accepts this for the `refresh_token` grant. Anthropic moved the token
/// endpoint from `console.anthropic.com` to `platform.claude.com`, so we try
/// both (the old host can now 404).
const OAUTH_CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const TOKEN_ENDPOINTS: [&str; 2] = [
    "https://console.anthropic.com/v1/oauth/token",
    "https://platform.claude.com/v1/oauth/token",
];
/// Refresh this many milliseconds before the token actually expires so a poll
/// never races the boundary.
const EXPIRY_BUFFER_MS: i64 = 60_000;

/// Serializes token refresh across the whole process. Both the `get_usage`
/// command and the background poller call `get()`, and a refresh_token is
/// single-use (it rotates) — two concurrent refreshes would invalidate each
/// other. Holding this lock lets the loser observe the winner's fresh token
/// (re-read from disk) instead of spending a now-dead refresh token.
static REFRESH_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

#[derive(Debug, Error)]
pub enum ClaudeError {
    #[error("credentials not found")]
    NoCredentials,
    #[error("unauthorized")]
    Unauthorized,
    /// HTTP 429. `retry_after` is the server's `Retry-After` hint in seconds,
    /// when present and numeric.
    #[error("rate limited")]
    RateLimited { retry_after: Option<u64> },
    #[error("http error: {0}")]
    Http(String),
    #[error("refresh error: {0}")]
    Refresh(String),
    #[error("parse error: {0}")]
    Parse(String),
}

impl ClaudeError {
    /// Stable, generic message safe to surface to the frontend. The `Display`
    /// impl above keeps verbose detail (URLs, parse offsets, response fragments)
    /// for internal use only — never send it across the IPC boundary.
    pub fn user_message(&self) -> &'static str {
        match self {
            ClaudeError::NoCredentials => "credentials not found",
            ClaudeError::Unauthorized => "credentials not found",
            // Transient — the frontend keeps the last good chart for this one.
            ClaudeError::RateLimited { .. } => "request failed",
            ClaudeError::Http(_) => "request failed",
            ClaudeError::Refresh(_) => "request failed",
            ClaudeError::Parse(_) => "invalid response",
        }
    }
}

pub struct ClaudeCreds {
    pub access_token: String,
    pub refresh_token: Option<String>,
    /// Absolute expiry in unix **milliseconds** (matches `.credentials.json`).
    pub expires_at: Option<i64>,
    pub subscription_type: String,
    pub rate_limit_tier: String,
}

/// New token material returned by a successful refresh.
struct RefreshedTokens {
    access_token: String,
    refresh_token: String,
    expires_at: Option<i64>,
}

#[derive(Deserialize)]
struct RefreshResponse {
    access_token: String,
    /// The refresh token usually rotates; if the server omits it we keep the old one.
    refresh_token: Option<String>,
    /// Lifetime in seconds.
    expires_in: Option<i64>,
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
    #[serde(rename = "refreshToken")]
    refresh_token: Option<String>,
    #[serde(rename = "expiresAt")]
    expires_at: Option<i64>,
    #[serde(rename = "subscriptionType")]
    subscription_type: Option<String>,
    #[serde(rename = "rateLimitTier")]
    rate_limit_tier: Option<String>,
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

pub fn read_credentials(claude_home: &Path) -> Result<ClaudeCreds, ClaudeError> {
    let path = claude_home.join(".credentials.json");
    let txt = std::fs::read_to_string(&path).map_err(|_| ClaudeError::NoCredentials)?;
    let f: CredFile = serde_json::from_str(&txt).map_err(|e| ClaudeError::Parse(e.to_string()))?;
    let o = f.oauth.ok_or(ClaudeError::NoCredentials)?;
    Ok(ClaudeCreds {
        access_token: o.access_token,
        refresh_token: o.refresh_token,
        expires_at: o.expires_at,
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
        .timeout(std::time::Duration::from_secs(20))
        .send()
        .await
        .map_err(|e| ClaudeError::Http(e.to_string()))?;
    // 401/403 mean the access token is stale or was revoked server-side — signal
    // the caller to refresh and retry rather than collapsing to an error card.
    if resp.status() == reqwest::StatusCode::UNAUTHORIZED
        || resp.status() == reqwest::StatusCode::FORBIDDEN
    {
        return Err(ClaudeError::Unauthorized);
    }
    if resp.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
        // `Retry-After` is either a number of seconds or an HTTP date; we honor
        // the numeric form and let the poller's exponential backoff cover the rest.
        let retry_after = resp
            .headers()
            .get(reqwest::header::RETRY_AFTER)
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.trim().parse::<u64>().ok());
        return Err(ClaudeError::RateLimited { retry_after });
    }
    if !resp.status().is_success() {
        return Err(ClaudeError::Http(format!("status {}", resp.status())));
    }
    let body = resp.text().await.map_err(|e| ClaudeError::Http(e.to_string()))?;
    let now = chrono::Utc::now().timestamp();
    parse_usage(&body, &creds.subscription_type, &creds.rate_limit_tier, now)
}

/// True when the token is expired or within `EXPIRY_BUFFER_MS` of expiring.
/// Unknown expiry (`None`) → don't preemptively refresh; rely on the reactive
/// 401 path so we never spend the single-use refresh token needlessly.
fn needs_refresh(expires_at_ms: Option<i64>, now_ms: i64) -> bool {
    match expires_at_ms {
        Some(exp) => now_ms >= exp - EXPIRY_BUFFER_MS,
        None => false,
    }
}

/// Parse a token endpoint response into new token material, computing the
/// absolute expiry (unix ms) from `expires_in` (seconds). Falls back to the
/// previous refresh token when the server doesn't rotate it.
fn parse_refresh_response(
    body: &str,
    prev_refresh: &str,
    now_ms: i64,
) -> Result<RefreshedTokens, ClaudeError> {
    let r: RefreshResponse =
        serde_json::from_str(body).map_err(|e| ClaudeError::Refresh(e.to_string()))?;
    Ok(RefreshedTokens {
        access_token: r.access_token,
        refresh_token: r.refresh_token.unwrap_or_else(|| prev_refresh.to_string()),
        expires_at: r.expires_in.map(|s| now_ms + s * 1000),
    })
}

/// POST a `refresh_token` grant, trying each known token endpoint until one
/// succeeds (the old host can 404 after Anthropic's migration).
async fn do_refresh(refresh_token: &str, now_ms: i64) -> Result<RefreshedTokens, ClaudeError> {
    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": OAUTH_CLIENT_ID,
    });
    let mut last_err = String::from("no endpoint reached");
    for url in TOKEN_ENDPOINTS {
        match client
            .post(url)
            .header("Content-Type", "application/json")
            .header("User-Agent", "anthropic")
            .timeout(std::time::Duration::from_secs(20))
            .json(&body)
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                let txt = resp
                    .text()
                    .await
                    .map_err(|e| ClaudeError::Refresh(e.to_string()))?;
                return parse_refresh_response(&txt, refresh_token, now_ms);
            }
            Ok(resp) => last_err = format!("status {}", resp.status()),
            Err(e) => last_err = e.to_string(),
        }
    }
    Err(ClaudeError::Refresh(last_err))
}

/// Atomically write refreshed tokens back into `.credentials.json`, preserving
/// every other field (and the CLI's file layout). Writes to a sibling temp file
/// with `0600` perms, then renames over the original.
fn write_back_tokens(claude_home: &Path, tokens: &RefreshedTokens) -> Result<(), ClaudeError> {
    let path = claude_home.join(".credentials.json");
    let txt = std::fs::read_to_string(&path).map_err(|_| ClaudeError::NoCredentials)?;
    let mut v: serde_json::Value =
        serde_json::from_str(&txt).map_err(|e| ClaudeError::Parse(e.to_string()))?;
    let oauth = v
        .get_mut("claudeAiOauth")
        .and_then(|o| o.as_object_mut())
        .ok_or(ClaudeError::NoCredentials)?;
    oauth.insert("accessToken".into(), serde_json::json!(tokens.access_token));
    oauth.insert("refreshToken".into(), serde_json::json!(tokens.refresh_token));
    if let Some(exp) = tokens.expires_at {
        oauth.insert("expiresAt".into(), serde_json::json!(exp));
    }
    let serialized =
        serde_json::to_string_pretty(&v).map_err(|e| ClaudeError::Parse(e.to_string()))?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serialized).map_err(|e| ClaudeError::Refresh(e.to_string()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
    }
    std::fs::rename(&tmp, &path).map_err(|e| ClaudeError::Refresh(e.to_string()))?;
    Ok(())
}

/// Ensure `creds` holds a usable access token, refreshing under the process-wide
/// lock when needed. Re-reads the file inside the lock first: another task — or
/// the Claude CLI itself — may have already refreshed, letting us skip spending
/// our refresh token. When `force` is set (reactive 401 path) we refresh even if
/// the local clock says the token is still valid, unless the on-disk token
/// already changed (the CLI beat us to it).
async fn ensure_fresh(
    home: &Path,
    creds: &mut ClaudeCreds,
    force: bool,
) -> Result<(), ClaudeError> {
    let _guard = REFRESH_LOCK.lock().await;
    let before = creds.access_token.clone();
    if let Ok(fresh) = read_credentials(home) {
        *creds = fresh;
    }
    let disk_changed = creds.access_token != before;
    let now_ms = chrono::Utc::now().timestamp_millis();
    if force {
        // The CLI already rotated the token on disk — use it, don't burn ours.
        if disk_changed {
            return Ok(());
        }
    } else if !needs_refresh(creds.expires_at, now_ms) {
        // Someone refreshed while we waited on the lock (or it was never stale).
        return Ok(());
    }
    let refresh_token = creds
        .refresh_token
        .clone()
        .ok_or(ClaudeError::Unauthorized)?;
    let tokens = do_refresh(&refresh_token, now_ms).await?;
    // Best-effort persist so the CLI and future polls see the new tokens; a write
    // failure still lets this call proceed with the in-memory tokens.
    let _ = write_back_tokens(home, &tokens);
    creds.access_token = tokens.access_token;
    creds.refresh_token = Some(tokens.refresh_token);
    creds.expires_at = tokens.expires_at;
    Ok(())
}

pub async fn get() -> Result<UsageSnapshot, ClaudeError> {
    let home = dirs::home_dir().ok_or(ClaudeError::NoCredentials)?.join(".claude");
    let mut creds = read_credentials(&home)?;

    // Proactive: refresh before the request if the token is (near) expired.
    if needs_refresh(creds.expires_at, chrono::Utc::now().timestamp_millis()) {
        // Best-effort — if it fails, still try the current token; the CLI may
        // have a working one, or the reactive path below recovers.
        let _ = ensure_fresh(&home, &mut creds, false).await;
    }

    match fetch(&creds).await {
        // Reactive: token rejected despite our checks — refresh once and retry.
        Err(ClaudeError::Unauthorized) => {
            ensure_fresh(&home, &mut creds, true).await?;
            fetch(&creds).await
        }
        other => other,
    }
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
        match &raw.five_hour {
            Some(w) => windows.push(LimitWindow {
                id: WindowId::ClaudeSession,
                used_percent: w.utilization.unwrap_or(0.0),
                resets_at: w.resets_at.as_deref().and_then(iso8601_to_epoch),
                available: true,
            }),
            None => windows.push(LimitWindow::unavailable(WindowId::ClaudeSession)),
        }
    }
    if !have_weekly_all {
        match &raw.seven_day {
            Some(w) => windows.push(LimitWindow {
                id: WindowId::ClaudeWeeklyAll,
                used_percent: w.utilization.unwrap_or(0.0),
                resets_at: w.resets_at.as_deref().and_then(iso8601_to_epoch),
                available: true,
            }),
            None => windows.push(LimitWindow::unavailable(WindowId::ClaudeWeeklyAll)),
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
            // Claude Code emits synthetic assistant messages (model:"<synthetic>")
            // with all-zero usage; skip them so they don't create junk zero-token
            // rows or flip `cost_estimable` to false for an unpriced model.
            if usage.input_tokens == 0
                && usage.output_tokens == 0
                && usage.cache_creation_input_tokens == 0
                && usage.cache_read_input_tokens == 0
            {
                continue;
            }
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
        assert_eq!(session.resets_at, Some(1783999799));
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

    #[test]
    fn empty_body_yields_three_unavailable_windows() {
        let s = parse_usage("{}", "max", "default_claude_max_20x", 0).unwrap();
        assert_eq!(s.windows.len(), 3);
        assert!(s.windows.iter().all(|w| !w.available));
        assert!(s.windows.iter().any(|w| w.id == WindowId::ClaudeSession));
        assert!(s.windows.iter().any(|w| w.id == WindowId::ClaudeWeeklyAll));
        assert!(s.windows.iter().any(|w| w.id == WindowId::ClaudeWeeklyFable));
    }

    #[test]
    fn reads_credentials_from_file() {
        let dir = std::env::temp_dir().join(format!("claude-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join(".credentials.json"),
            r#"{"claudeAiOauth":{"accessToken":"tok123","refreshToken":"rt456","expiresAt":1784016175582,"subscriptionType":"max","rateLimitTier":"default_claude_max_20x"}}"#,
        ).unwrap();
        let creds = read_credentials(&dir).unwrap();
        assert_eq!(creds.access_token, "tok123");
        assert_eq!(creds.refresh_token.as_deref(), Some("rt456"));
        assert_eq!(creds.expires_at, Some(1784016175582));
        assert_eq!(creds.subscription_type, "max");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn reads_credentials_without_refresh_fields() {
        // Older files may lack refreshToken/expiresAt — must degrade to None.
        let dir = std::env::temp_dir().join(format!("claude-norefresh-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join(".credentials.json"),
            r#"{"claudeAiOauth":{"accessToken":"tok","subscriptionType":"pro"}}"#,
        ).unwrap();
        let creds = read_credentials(&dir).unwrap();
        assert!(creds.refresh_token.is_none());
        assert!(creds.expires_at.is_none());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn needs_refresh_within_buffer() {
        let now = 1_000_000_000_000;
        // Expires exactly at `now` → refresh.
        assert!(needs_refresh(Some(now), now));
        // Already expired → refresh.
        assert!(needs_refresh(Some(now - 5_000), now));
        // Inside the 60s buffer → refresh.
        assert!(needs_refresh(Some(now + 30_000), now));
        // Comfortably valid → no refresh.
        assert!(!needs_refresh(Some(now + 3_600_000), now));
        // Unknown expiry → never preemptively refresh.
        assert!(!needs_refresh(None, now));
    }

    #[test]
    fn parse_refresh_computes_absolute_expiry() {
        let now = 1_000_000_000_000;
        let body = r#"{"access_token":"new_at","refresh_token":"new_rt","expires_in":3600}"#;
        let t = parse_refresh_response(body, "old_rt", now).unwrap();
        assert_eq!(t.access_token, "new_at");
        assert_eq!(t.refresh_token, "new_rt");
        // 3600s → +3_600_000 ms.
        assert_eq!(t.expires_at, Some(now + 3_600_000));
    }

    #[test]
    fn parse_refresh_keeps_old_token_when_not_rotated() {
        let now = 0;
        let body = r#"{"access_token":"new_at","expires_in":100}"#;
        let t = parse_refresh_response(body, "keep_me", now).unwrap();
        assert_eq!(t.refresh_token, "keep_me");
        assert_eq!(t.expires_at, Some(100_000));
    }

    #[test]
    fn write_back_preserves_other_fields() {
        let dir = std::env::temp_dir().join(format!("claude-wb-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join(".credentials.json"),
            r#"{"claudeAiOauth":{"accessToken":"old_at","refreshToken":"old_rt","expiresAt":1,"subscriptionType":"max","rateLimitTier":"tierX","scopes":["a","b"]}}"#,
        ).unwrap();
        let tokens = RefreshedTokens {
            access_token: "AT2".into(),
            refresh_token: "RT2".into(),
            expires_at: Some(999),
        };
        write_back_tokens(&dir, &tokens).unwrap();
        let creds = read_credentials(&dir).unwrap();
        assert_eq!(creds.access_token, "AT2");
        assert_eq!(creds.refresh_token.as_deref(), Some("RT2"));
        assert_eq!(creds.expires_at, Some(999));
        // Unrelated fields survive the rewrite.
        assert_eq!(creds.subscription_type, "max");
        assert_eq!(creds.rate_limit_tier, "tierX");
        let raw = std::fs::read_to_string(dir.join(".credentials.json")).unwrap();
        assert!(raw.contains("\"scopes\""));
        assert!(raw.contains("\"a\""));
        // No temp file left behind.
        assert!(!dir.join(".credentials.json.tmp").exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn missing_credentials_errors() {
        let dir = std::env::temp_dir().join("claude-nonexistent-xyz");
        assert!(matches!(read_credentials(&dir), Err(ClaudeError::NoCredentials)));
    }

    #[tokio::test]
    #[ignore]
    async fn claude_live_smoke() {
        let s = super::get().await.unwrap();
        assert_eq!(s.windows.len(), 3);
        println!("plan={} windows={:?}", s.plan, s.windows);
    }

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

    #[test]
    fn scan_usage_skips_synthetic_zero_usage() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();
        let pdir = home.join("projects/some-project");
        std::fs::create_dir_all(&pdir).unwrap();
        let synthetic = r#"{"type":"assistant","timestamp":"2026-07-08T06:09:03.964Z","message":{"model":"<synthetic>","usage":{"input_tokens":0,"output_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}"#;
        std::fs::write(pdir.join("s.jsonl"), format!("{synthetic}\n")).unwrap();

        let recs = scan_usage(home);
        assert_eq!(recs.len(), 0);
    }
}
