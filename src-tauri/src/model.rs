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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso8601_parses_to_epoch() {
        // 2026-07-14T03:29:59.895126+00:00 → 1783999799
        let e = iso8601_to_epoch("2026-07-14T03:29:59.895126+00:00").unwrap();
        assert_eq!(e, 1783999799);
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
