use crate::model::{iso8601_to_epoch, LimitWindow, ProviderId, Source, UsageSnapshot, WindowId};
use serde::Deserialize;
use std::path::Path;
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

    #[tokio::test]
    #[ignore]
    async fn claude_live_smoke() {
        let s = super::get().await.unwrap();
        assert_eq!(s.windows.len(), 3);
        println!("plan={} windows={:?}", s.plan, s.windows);
    }
}
