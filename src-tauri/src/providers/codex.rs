use crate::model::{
    year_month_of, LimitWindow, ProviderId, Source, UsageRecord, UsageSnapshot, WindowId,
};
use base64::Engine;
use serde::Deserialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use thiserror::Error;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, ChildStdout, Command};

#[derive(Debug, Error)]
pub enum CodexError {
    #[error("credentials not found")]
    NoCredentials,
    #[error("no rollout data")]
    NoRollout,
    #[error("parse error: {0}")]
    Parse(String),
    #[error("app-server error: {0}")]
    AppServer(String),
}

impl CodexError {
    /// Stable, generic message safe to surface to the frontend. The `Display`
    /// impl above keeps verbose parse detail for internal use only — never send
    /// it across the IPC boundary.
    pub fn user_message(&self) -> &'static str {
        match self {
            CodexError::NoCredentials => "credentials not found",
            CodexError::NoRollout => "no usage data",
            CodexError::Parse(_) => "invalid data",
            CodexError::AppServer(_) => "no usage data",
        }
    }
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
    window_minutes: Option<i64>,
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

#[derive(Deserialize)]
struct AppServerResult {
    #[serde(rename = "rateLimits")]
    rate_limits: Option<AppServerRateLimits>,
    #[serde(rename = "rateLimitsByLimitId", default)]
    by_limit_id: HashMap<String, AppServerLimit>,
}

#[derive(Deserialize)]
struct AppServerRateLimits {
    primary: Option<AppServerBucket>,
    secondary: Option<AppServerBucket>,
    #[serde(rename = "planType")]
    plan_type: Option<String>,
}

#[derive(Deserialize)]
struct AppServerBucket {
    #[serde(rename = "usedPercent")]
    used_percent: Option<f64>,
    #[serde(rename = "windowDurationMins")]
    window_duration_mins: Option<i64>,
    #[serde(rename = "resetsAt")]
    resets_at: Option<i64>,
}

#[derive(Deserialize)]
struct AppServerLimit {
    #[serde(rename = "limitId")]
    limit_id: Option<String>,
    #[serde(rename = "limitName")]
    limit_name: Option<String>,
    primary: Option<AppServerBucket>,
    secondary: Option<AppServerBucket>,
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
            c.next()
                .map(|f| f.to_uppercase().collect::<String>() + c.as_str())
                .unwrap_or_default()
        }
    }
}

fn window_from(bucket: Option<&Bucket>, id: WindowId) -> LimitWindow {
    match bucket {
        Some(b) => LimitWindow {
            id,
            used_percent: b.used_percent,
            resets_at: b.resets_at,
            available: true,
        },
        None => LimitWindow::unavailable(id),
    }
}

fn weekly_rollout_bucket(rate_limits: &RateLimits) -> Option<&Bucket> {
    let candidates = [rate_limits.primary.as_ref(), rate_limits.secondary.as_ref()];
    if let Some(bucket) = candidates
        .into_iter()
        .flatten()
        .find(|bucket| bucket.window_minutes == Some(10080))
    {
        return Some(bucket);
    }

    // Older rollout entries did not include window_minutes and used
    // secondary for the weekly window.
    let has_duration = rate_limits
        .primary
        .as_ref()
        .or(rate_limits.secondary.as_ref())
        .and_then(|bucket| bucket.window_minutes)
        .is_some();
    if !has_duration {
        return rate_limits
            .secondary
            .as_ref()
            .or(rate_limits.primary.as_ref());
    }
    None
}

pub fn parse_rate_limits(
    json: &str,
    plan_raw: &str,
    source: Source,
    updated_at: i64,
) -> Result<UsageSnapshot, CodexError> {
    let rl: RateLimits =
        serde_json::from_str(json).map_err(|e| CodexError::Parse(e.to_string()))?;
    let effective_plan = if plan_raw.is_empty() {
        rl.plan_type.clone().unwrap_or_default()
    } else {
        plan_raw.to_string()
    };
    let windows = vec![
        window_from(weekly_rollout_bucket(&rl), WindowId::CodexWeekly),
        // Spark: rollout rate_limits에는 없음.
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

fn app_server_window(bucket: Option<&AppServerBucket>, id: WindowId) -> LimitWindow {
    match bucket.and_then(|b| b.used_percent) {
        Some(used_percent) => LimitWindow {
            id,
            used_percent,
            resets_at: bucket.and_then(|b| b.resets_at),
            available: true,
        },
        None => LimitWindow::unavailable(id),
    }
}

fn app_server_bucket_for_duration<'a>(
    primary: Option<&'a AppServerBucket>,
    secondary: Option<&'a AppServerBucket>,
    duration_mins: i64,
) -> Option<&'a AppServerBucket> {
    let buckets = [primary, secondary];
    if let Some(bucket) = buckets
        .into_iter()
        .flatten()
        .find(|bucket| bucket.window_duration_mins == Some(duration_mins))
    {
        return Some(bucket);
    }

    // Very old app-server responses may omit windowDurationMins. Preserve the
    // original primary/secondary convention only for those responses.
    let has_duration = primary
        .or(secondary)
        .and_then(|bucket| bucket.window_duration_mins)
        .is_some();
    if !has_duration {
        return match duration_mins {
            300 => primary,
            10080 => secondary,
            _ => None,
        };
    }
    None
}

fn app_server_spark_bucket(
    by_limit_id: &HashMap<String, AppServerLimit>,
) -> Option<&AppServerBucket> {
    by_limit_id
        .values()
        .find(|limit| {
            limit.limit_name.as_deref() == Some("GPT-5.3-Codex-Spark")
                || limit
                    .limit_id
                    .as_deref()
                    .is_some_and(|id| id.contains("bengalfox"))
        })
        .and_then(|limit| {
            app_server_bucket_for_duration(limit.primary.as_ref(), limit.secondary.as_ref(), 10080)
                .or(limit.primary.as_ref())
                .or(limit.secondary.as_ref())
        })
}

/// Convert the app-server's camelCase rate-limit response to the common model.
/// The app-server is the live source; Spark is read from its per-limit map
/// when the current Codex build exposes that entry.
pub fn parse_app_server_rate_limits(
    result: serde_json::Value,
    plan_raw: &str,
    updated_at: i64,
) -> Result<UsageSnapshot, CodexError> {
    let result: AppServerResult =
        serde_json::from_value(result).map_err(|e| CodexError::Parse(e.to_string()))?;
    let by_limit_id = result.by_limit_id;
    let limits = result
        .rate_limits
        .ok_or_else(|| CodexError::Parse("missing rate limits".into()))?;
    let effective_plan = if plan_raw.is_empty() {
        limits.plan_type.as_deref().unwrap_or_default()
    } else {
        plan_raw
    };
    Ok(UsageSnapshot {
        provider: ProviderId::Codex,
        plan: plan_label(effective_plan),
        plan_raw: effective_plan.to_string(),
        source: Source::Live,
        updated_at,
        windows: vec![
            app_server_window(
                app_server_bucket_for_duration(
                    limits.primary.as_ref(),
                    limits.secondary.as_ref(),
                    10080,
                ),
                WindowId::CodexWeekly,
            ),
            app_server_window(
                app_server_spark_bucket(&by_limit_id),
                WindowId::CodexSparkWeekly,
            ),
        ],
        error: None,
    })
}

pub fn plan_from_id_token(id_token: &str) -> Option<String> {
    let payload = id_token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .ok()?;
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
                // Use the dir entry's own file type (does NOT follow symlinks),
                // and skip symlinked entries so a planted link can't redirect the
                // walk outside ~/.codex/sessions.
                let Ok(ft) = e.file_type() else { continue };
                if ft.is_symlink() {
                    continue;
                }
                let p = e.path();
                if ft.is_dir() {
                    stack.push(p);
                } else if ft.is_file() && p.extension().map(|x| x == "jsonl").unwrap_or(false) {
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

fn codex_home() -> Result<PathBuf, CodexError> {
    std::env::var_os("CODEX_HOME")
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|home| home.join(".codex")))
        .ok_or(CodexError::NoCredentials)
}

async fn write_json_line(
    writer: &mut ChildStdin,
    value: serde_json::Value,
) -> Result<(), CodexError> {
    let mut line = serde_json::to_vec(&value).map_err(|e| CodexError::AppServer(e.to_string()))?;
    line.push(b'\n');
    writer
        .write_all(&line)
        .await
        .map_err(|e| CodexError::AppServer(e.to_string()))?;
    writer
        .flush()
        .await
        .map_err(|e| CodexError::AppServer(e.to_string()))
}

async fn read_response(
    reader: &mut BufReader<ChildStdout>,
    expected_id: u64,
) -> Result<serde_json::Value, CodexError> {
    loop {
        let mut line = String::new();
        let read = reader
            .read_line(&mut line)
            .await
            .map_err(|e| CodexError::AppServer(e.to_string()))?;
        if read == 0 {
            return Err(CodexError::AppServer(
                "app-server exited unexpectedly".into(),
            ));
        }

        let message: serde_json::Value =
            serde_json::from_str(&line).map_err(|e| CodexError::AppServer(e.to_string()))?;
        if message.get("id").and_then(serde_json::Value::as_u64) != Some(expected_id) {
            // Notifications can arrive between request and response. They are
            // irrelevant for this one-shot account query.
            continue;
        }
        if let Some(error) = message.get("error") {
            return Err(CodexError::AppServer(error.to_string()));
        }
        return message
            .get("result")
            .cloned()
            .ok_or_else(|| CodexError::AppServer("response has no result".into()));
    }
}

/// Ask the installed Codex CLI for the same rate-limit data shown by its
/// status bar. This avoids calling the undocumented ChatGPT backend endpoint
/// directly and keeps authentication inside the official Codex process.
async fn fetch_app_server() -> Result<serde_json::Value, CodexError> {
    let mut child = Command::new("codex")
        .args(["app-server", "--stdio"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| CodexError::AppServer(e.to_string()))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| CodexError::AppServer("app-server stdin unavailable".into()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| CodexError::AppServer("app-server stdout unavailable".into()))?;
    let mut reader = BufReader::new(stdout);

    write_json_line(
        &mut stdin,
        serde_json::json!({
            "method": "initialize",
            "id": 1,
            "params": {
                "clientInfo": {
                    "name": "token_usage_app",
                    "title": "Token Usage App",
                    "version": env!("CARGO_PKG_VERSION")
                }
            }
        }),
    )
    .await?;
    read_response(&mut reader, 1).await?;

    write_json_line(
        &mut stdin,
        serde_json::json!({ "method": "initialized", "params": {} }),
    )
    .await?;
    write_json_line(
        &mut stdin,
        serde_json::json!({ "method": "account/rateLimits/read", "id": 2, "params": {} }),
    )
    .await?;
    let result = read_response(&mut reader, 2).await;
    let _ = child.kill().await;
    result
}

fn extract_balanced_object(s: &str) -> Option<&str> {
    let bytes = s.as_bytes();
    let mut depth = 0usize;
    let mut in_str = false;
    let mut esc = false;
    for (i, &b) in bytes.iter().enumerate() {
        if in_str {
            if esc {
                esc = false;
            } else if b == b'\\' {
                esc = true;
            } else if b == b'"' {
                in_str = false;
            }
            continue;
        }
        match b {
            b'"' => in_str = true,
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(&s[..=i]);
                }
            }
            _ => {}
        }
    }
    None
}

/// Codex usage snapshot.
///
/// Prefer the official app-server `account/rateLimits/read` method, which is
/// the same source used by Codex rich clients. Older CLI versions may not have
/// that method (or Codex may not be installed on PATH), so rollout snapshots
/// remain a useful local fallback. Spark is available when the app-server
/// exposes its per-limit entry; rollout data still cannot provide it.
pub async fn get() -> Result<UsageSnapshot, CodexError> {
    let home = codex_home()?;
    let plan_type = read_plan_type(&home).unwrap_or_default();

    if let Ok(result) =
        tokio::time::timeout(std::time::Duration::from_secs(15), fetch_app_server()).await
    {
        if let Ok(result) = result {
            if let Ok(snapshot) =
                parse_app_server_rate_limits(result, &plan_type, chrono::Utc::now().timestamp())
            {
                return Ok(snapshot);
            }
        }
    }

    let (json, updated_at) = latest_rollout_snapshot(&home)?;
    // If auth.json is absent, parse_rate_limits falls back to plan_type in the
    // rollout event.
    parse_rate_limits(&json, &plan_type, Source::Cache, updated_at)
}

// ---- Historical usage scan (issue #19) ----

#[derive(serde::Deserialize)]
struct ScanLine {
    #[serde(rename = "type")]
    kind: Option<String>,
    timestamp: Option<String>,
    payload: Option<serde_json::Value>,
}

/// Scan `~/.codex/sessions/**/*.jsonl`. Each `token_count` event contributes its
/// `last_token_usage` delta, bucketed by the event month and attributed to the
/// most recent `turn_context.model` seen in that file.
///
/// Real rollout logs carry the `turn_context` discriminant at the TOP LEVEL
/// (`{"type":"turn_context","payload":{"model":...}}`) — the payload itself has
/// no `"type"` key for these lines. `token_count` events, by contrast, are
/// wrapped in an `event_msg` envelope with the discriminant INSIDE `payload`
/// (`{"type":"event_msg","payload":{"type":"token_count",...}}`).
pub fn scan_usage(codex_home: &Path) -> Vec<UsageRecord> {
    let mut out = Vec::new();
    for path in walk_jsonl(&codex_home.join("sessions")) {
        let Ok(content) = std::fs::read_to_string(&path) else { continue };
        let mut current_model = "unknown".to_string();
        for line in content.lines() {
            let Ok(l) = serde_json::from_str::<ScanLine>(line) else { continue };
            if l.kind.as_deref() == Some("turn_context") {
                if let Some(m) = l
                    .payload
                    .as_ref()
                    .and_then(|p| p.get("model"))
                    .and_then(|v| v.as_str())
                {
                    current_model = m.to_string();
                }
                continue;
            }
            let Some(payload) = l.payload.as_ref() else { continue };
            if payload.get("type").and_then(|v| v.as_str()) == Some("token_count") {
                let Some(ym) = l.timestamp.as_deref().and_then(year_month_of) else { continue };
                let Some(last) = payload.get("info").and_then(|i| i.get("last_token_usage")) else { continue };
                let get = |k: &str| last.get(k).and_then(|v| v.as_u64()).unwrap_or(0);
                let input = get("input_tokens");
                let cached = get("cached_input_tokens");
                let output = get("output_tokens");
                if input == 0 && output == 0 { continue; }
                out.push(UsageRecord {
                    year_month: ym,
                    provider: ProviderId::Codex,
                    model: current_model.clone(),
                    input_tokens: input,
                    output_tokens: output,
                    cache_write_tokens: 0,
                    cache_read_tokens: 0,
                    cached_input_tokens: cached,
                });
            }
        }
    }
    out
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
        let week = s
            .windows
            .iter()
            .find(|w| w.id == WindowId::CodexWeekly)
            .unwrap();
        assert_eq!(week.used_percent, 11.0);
        let spark = s
            .windows
            .iter()
            .find(|w| w.id == WindowId::CodexSparkWeekly)
            .unwrap();
        assert!(!spark.available);
        assert_eq!(s.source, Source::Cache);
    }

    #[test]
    fn parses_app_server_rate_limits() {
        let result = serde_json::json!({
            "rateLimits": {
                "primary": {
                    "usedPercent": 25.0,
                    "windowDurationMins": 300,
                    "resetsAt": 1783661689
                },
                "secondary": {
                    "usedPercent": 11.0,
                    "windowDurationMins": 10080,
                    "resetsAt": 1784248489
                }
            },
            "rateLimitsByLimitId": {
                "codex_bengalfox": {
                    "limitId": "codex_bengalfox",
                    "limitName": "GPT-5.3-Codex-Spark",
                    "primary": {
                        "usedPercent": 4.0,
                        "windowDurationMins": 10080,
                        "resetsAt": 1784248489
                    },
                    "secondary": null
                }
            }
        });
        let s = parse_app_server_rate_limits(result, "pro", 10).unwrap();
        let week = s
            .windows
            .iter()
            .find(|w| w.id == WindowId::CodexWeekly)
            .unwrap();
        assert_eq!(week.used_percent, 11.0);
        let spark = s
            .windows
            .iter()
            .find(|w| w.id == WindowId::CodexSparkWeekly)
            .unwrap();
        assert_eq!(spark.used_percent, 4.0);
        assert_eq!(spark.resets_at, Some(1784248489));
        assert_eq!(s.source, Source::Live);
    }

    #[test]
    fn app_server_null_windows_are_unavailable() {
        let result = serde_json::json!({
            "rateLimits": { "primary": null, "secondary": null }
        });
        let s = parse_app_server_rate_limits(result, "plus", 10).unwrap();
        assert!(s.windows.iter().all(|window| !window.available));
    }

    #[test]
    fn null_windows_are_unavailable() {
        let s = parse_rate_limits(NULLED, "pro", Source::Cache, 0).unwrap();
        let week = s
            .windows
            .iter()
            .find(|w| w.id == WindowId::CodexWeekly)
            .unwrap();
        assert!(!week.available);
    }

    #[test]
    fn plan_label_maps_known() {
        assert_eq!(plan_label("pro"), "Pro");
        assert_eq!(plan_label("prolite"), "Pro (Lite)");
        assert_eq!(plan_label("plus"), "Plus");
    }

    #[test]
    fn snapshot_selects_newest_populated_reading() {
        let dir = std::env::temp_dir().join(format!("codex-roll-{}", std::process::id()));
        let sdir = dir.join("sessions/2026/07/14");
        std::fs::create_dir_all(&sdir).unwrap();
        let content = include_str!("../../tests/fixtures/rollout_sample.jsonl");
        std::fs::write(sdir.join("rollout-2026-07-14T09-00-00-abc.jsonl"), content).unwrap();
        let (rl, _mtime) = latest_rollout_snapshot(&dir).unwrap();
        // 마지막(최신) 스냅샷의 주간 한도: 11.0
        assert!(rl.contains("73"));
        let s = parse_rate_limits(&rl, "", Source::Cache, 0).unwrap();
        let week = s
            .windows
            .iter()
            .find(|w| w.id == WindowId::CodexWeekly)
            .unwrap();
        assert_eq!(week.used_percent, 11.0);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn decodes_plan_type_from_id_token() {
        // payload: {"https://api.openai.com/auth":{"chatgpt_plan_type":"pro"}}
        let payload =
            "eyJodHRwczovL2FwaS5vcGVuYWkuY29tL2F1dGgiOnsiY2hhdGdwdF9wbGFuX3R5cGUiOiJwcm8ifX0";
        let jwt = format!("aaa.{}.bbb", payload);
        assert_eq!(plan_from_id_token(&jwt), Some("pro".to_string()));
    }

    #[tokio::test]
    #[ignore]
    async fn codex_smoke() {
        // Manual: reads real ~/.codex rollouts. Run: cargo test codex_smoke -- --ignored --nocapture
        let s = super::get().await.unwrap();
        assert_eq!(s.windows.len(), 2);
        println!(
            "plan={} source={:?} updated_at={} windows={:?}",
            s.plan, s.source, s.updated_at, s.windows
        );
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
        let week = s
            .windows
            .iter()
            .find(|w| w.id == WindowId::CodexWeekly)
            .unwrap();
        assert!(week.available);
        assert_eq!(week.used_percent, 9.0);
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

    #[test]
    fn scan_usage_sums_last_token_deltas_by_model() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();
        let sdir = home.join("sessions/2026/07/14");
        std::fs::create_dir_all(&sdir).unwrap();
        let ctx = r#"{"type":"turn_context","timestamp":"2026-07-14T00:00:00.000Z","payload":{"model":"gpt-5.5"}}"#;
        let tc1 = r#"{"type":"event_msg","timestamp":"2026-07-14T00:01:00.000Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":1000,"cached_input_tokens":400,"output_tokens":50}}}}"#;
        let tc2 = r#"{"type":"event_msg","timestamp":"2026-07-14T00:02:00.000Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":0,"cached_input_tokens":0,"output_tokens":0}}}}"#;
        std::fs::write(sdir.join("rollout-x.jsonl"), format!("{ctx}\n{tc1}\n{tc2}\nbroken\n")).unwrap();

        let recs = scan_usage(home);
        // tc2 is all-zero and skipped; only tc1 recorded
        assert_eq!(recs.len(), 1);
        let r = &recs[0];
        assert_eq!(r.year_month, "2026-07");
        assert_eq!(r.provider, ProviderId::Codex);
        assert_eq!(r.model, "gpt-5.5");
        assert_eq!(r.input_tokens, 1000);
        assert_eq!(r.cached_input_tokens, 400);
        assert_eq!(r.output_tokens, 50);
    }
}
