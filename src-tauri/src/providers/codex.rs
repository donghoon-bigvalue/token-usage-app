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
