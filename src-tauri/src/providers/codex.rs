use crate::model::{LimitWindow, ProviderId, Source, UsageSnapshot, WindowId};
use base64::Engine;
use serde::Deserialize;
use std::path::{Path, PathBuf};
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
}
