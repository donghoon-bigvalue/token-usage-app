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

#[derive(Deserialize)]
struct AuthFile {
    tokens: Option<Tokens>,
}

#[derive(Deserialize)]
struct Tokens {
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

/// Authoritative plan type from the id_token subscription claim in `auth.json`.
/// Best-effort: returns `None` if auth.json is missing/malformed (the caller
/// then falls back to the plan_type embedded in the rollout snapshot).
pub fn read_plan_type(codex_home: &Path) -> Option<String> {
    let txt = std::fs::read_to_string(codex_home.join("auth.json")).ok()?;
    let f: AuthFile = serde_json::from_str(&txt).ok()?;
    f.tokens?.id_token.as_deref().and_then(plan_from_id_token)
}

/// All rollout files under `sessions/`, newest mtime first, paired with mtime (unix secs).
fn rollouts_newest_first(codex_home: &Path) -> Vec<(PathBuf, i64)> {
    let sessions = codex_home.join("sessions");
    let mut files: Vec<(PathBuf, i64)> = walk_jsonl(&sessions)
        .into_iter()
        .filter_map(|p| {
            let mtime = std::fs::metadata(&p)
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)?;
            Some((p, mtime))
        })
        .collect();
    files.sort_by(|a, b| b.1.cmp(&a.1));
    files
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

/// Extract the `rate_limits` balanced-brace JSON object from a single line, if present.
fn rate_limits_obj_in_line(line: &str) -> Option<String> {
    let idx = line.find("\"rate_limits\"")?;
    let after = &line[idx..];
    let brace = after.find('{')?;
    extract_balanced_object(&after[brace..]).map(|s| s.to_string())
}

/// Last `rate_limits` object in a file (reverse scan), regardless of null contents.
fn last_rate_limits_in(content: &str) -> Option<String> {
    content.lines().rev().find_map(rate_limits_obj_in_line)
}

/// A rate_limits snapshot is useful only if it actually carries a window.
/// Codex emits `rate_limits` events with null primary/secondary mid-session,
/// so we must find the most recent reading that has real data.
fn is_populated(rate_limits_json: &str) -> bool {
    serde_json::from_str::<RateLimits>(rate_limits_json)
        .map(|r| r.primary.is_some() || r.secondary.is_some())
        .unwrap_or(false)
}

/// Last `rate_limits` object in a file (reverse scan) whose primary or secondary is non-null.
fn last_populated_rate_limits_in(content: &str) -> Option<String> {
    content
        .lines()
        .rev()
        .filter_map(rate_limits_obj_in_line)
        .find(|obj| is_populated(obj))
}

pub fn latest_rollout_rate_limits(codex_home: &Path) -> Result<String, CodexError> {
    let (path, _) = rollouts_newest_first(codex_home)
        .into_iter()
        .next()
        .ok_or(CodexError::NoRollout)?;
    let content = std::fs::read_to_string(&path).map_err(|_| CodexError::NoRollout)?;
    last_rate_limits_in(&content).ok_or(CodexError::NoRollout)
}

/// The most recent POPULATED `rate_limits` object across rollout files (newest
/// file first, newest line within each), paired with that file's mtime (unix
/// secs) so the UI can show how fresh the numbers are. Skips null-window
/// snapshots. If no populated reading exists anywhere, returns the newest
/// file's last `rate_limits` (so plan + unavailable windows still render).
pub fn latest_rollout_snapshot(codex_home: &Path) -> Result<(String, i64), CodexError> {
    let files = rollouts_newest_first(codex_home);
    if files.is_empty() {
        return Err(CodexError::NoRollout);
    }
    for (path, mtime) in &files {
        if let Ok(content) = std::fs::read_to_string(path) {
            if let Some(json) = last_populated_rate_limits_in(&content) {
                return Ok((json, *mtime));
            }
        }
    }
    // No populated reading anywhere — fall back to the newest file's last object.
    let (path, mtime) = &files[0];
    let content = std::fs::read_to_string(path).map_err(|_| CodexError::NoRollout)?;
    let json = last_rate_limits_in(&content).ok_or(CodexError::NoRollout)?;
    Ok((json, *mtime))
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

/// Codex usage snapshot.
///
/// Codex exposes rate limits ONLY inside the `/responses` stream, which the CLI
/// persists to session rollouts — there is no standalone usage endpoint we can
/// call: `GET /backend-api/codex/usage` returns a Cloudflare managed challenge
/// (HTTP 403) via both curl and reqwest without a browser session (verified in
/// the Task 6 spike). So the newest rollout snapshot IS our source. This is the
/// same freshness the Codex CLI status line shows, since it too only learns its
/// limits from its most recent API turn.
///
/// The Spark weekly limit is not present anywhere in local rollout data and is
/// unreachable without the (blocked) live endpoint, so it stays `unavailable`
/// (best-effort, per spec §9-2).
pub async fn get() -> Result<UsageSnapshot, CodexError> {
    let home = dirs::home_dir().ok_or(CodexError::NoCredentials)?.join(".codex");
    let (json, updated_at) = latest_rollout_snapshot(&home)?;
    // Authoritative plan from the id_token when auth.json is present; otherwise
    // parse_rate_limits falls back to the plan_type embedded in the rollout.
    let plan_type = read_plan_type(&home).unwrap_or_default();
    parse_rate_limits(&json, &plan_type, Source::Cache, updated_at)
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

    #[tokio::test]
    #[ignore]
    async fn codex_smoke() {
        // Manual: reads real ~/.codex rollouts. Run: cargo test codex_smoke -- --ignored --nocapture
        let s = super::get().await.unwrap();
        assert_eq!(s.windows.len(), 3);
        println!("plan={} source={:?} updated_at={} windows={:?}", s.plan, s.source, s.updated_at, s.windows);
    }

    #[test]
    fn snapshot_skips_null_window_tail() {
        // Newest line has null primary/secondary; an earlier line is populated.
        // latest_rollout_snapshot must return the POPULATED reading (50.0), not null.
        let dir = std::env::temp_dir().join(format!("codex-nulltail-{}", std::process::id()));
        let sdir = dir.join("sessions/2026/07/14");
        std::fs::create_dir_all(&sdir).unwrap();
        let content = concat!(
            r#"{"payload":{"rate_limits":{"limit_id":"codex","primary":{"used_percent":50.0,"window_minutes":300,"resets_at":1783661000},"secondary":{"used_percent":9.0,"window_minutes":10080,"resets_at":1784248000},"plan_type":"pro"}}}"#,
            "\n",
            r#"{"payload":{"rate_limits":{"limit_id":"codex","primary":null,"secondary":null,"plan_type":"pro"}}}"#,
            "\n",
        );
        std::fs::write(sdir.join("rollout-2026-07-14T09-00-00-abc.jsonl"), content).unwrap();
        let (json, _mtime) = latest_rollout_snapshot(&dir).unwrap();
        let s = parse_rate_limits(&json, "pro", Source::Cache, 0).unwrap();
        let five = s.windows.iter().find(|w| w.id == WindowId::CodexFiveHour).unwrap();
        assert!(five.available);
        assert_eq!(five.used_percent, 50.0);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn snapshot_returns_json_and_mtime() {
        let dir = std::env::temp_dir().join(format!("codex-snap-{}", std::process::id()));
        let sdir = dir.join("sessions/2026/07/14");
        std::fs::create_dir_all(&sdir).unwrap();
        let content = include_str!("../../tests/fixtures/rollout_sample.jsonl");
        std::fs::write(sdir.join("rollout-2026-07-14T09-00-00-abc.jsonl"), content).unwrap();
        let (json, mtime) = latest_rollout_snapshot(&dir).unwrap();
        assert!(json.contains("73"));
        assert!(mtime > 0, "mtime should be a real unix timestamp");
        std::fs::remove_dir_all(&dir).ok();
    }
}
