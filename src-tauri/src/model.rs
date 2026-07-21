use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
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

/// `YYYY-MM` prefix of an ISO8601 timestamp, or None if it doesn't look like one.
/// Validates the `YYYY-MM-` shape (digits + dashes) so junk lines are skipped.
pub fn year_month_of(ts: &str) -> Option<String> {
    let b = ts.as_bytes();
    if b.len() < 8 { return None; }
    let ok = b[0..4].iter().all(u8::is_ascii_digit)
        && b[4] == b'-'
        && b[5].is_ascii_digit()
        && b[6].is_ascii_digit()
        && b[7] == b'-';
    if ok { Some(ts[0..7].to_string()) } else { None }
}

/// One raw usage sample before aggregation. Token fields carry provider-specific
/// meaning (see Global Constraints): Claude cache fields are separate; Codex
/// `input_tokens` already includes `cached_input_tokens`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UsageRecord {
    pub year_month: String,
    pub provider: ProviderId,
    pub model: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_write_tokens: u64,
    pub cache_read_tokens: u64,
    pub cached_input_tokens: u64,
}

/// One aggregated row: (year_month × provider × model). Used for CSV detail.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MonthlyDetail {
    pub year_month: String,
    pub provider: ProviderId,
    pub model: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_write_tokens: u64,
    pub cache_read_tokens: u64,
    pub cached_input_tokens: u64,
    /// Tokens the user actually spent: input + output with the provider's cache
    /// accounting normalized away. Comparable across providers, unlike
    /// `total_tokens`. See `history::display_buckets`.
    pub direct_tokens: u64,
    pub total_tokens: u64,
    pub cost_usd: Option<f64>,
}

/// One summary row: (year_month × provider). Used for the on-screen table.
/// `cost_estimable` is false when any model in the bucket lacked pricing.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MonthlySummary {
    pub year_month: String,
    pub provider: ProviderId,
    /// Display-normalized buckets — these four always sum to `total_tokens`.
    /// The names describe what the user sees, not the raw log field: for Codex
    /// `input_tokens` has its cached reads stripped out and `cache_read_tokens`
    /// comes from `cached_input_tokens`.
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    /// `input_tokens + output_tokens`. The headline number on screen.
    pub direct_tokens: u64,
    pub total_tokens: u64,
    pub cost_usd: Option<f64>,
    pub cost_estimable: bool,
}

/// Full history payload returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageHistory {
    pub current_month: String,
    /// Unix seconds when the logs were scanned. Survives caching, so the header
    /// can show when this data was actually read rather than when it was served.
    pub scanned_at: i64,
    pub summaries: Vec<MonthlySummary>,
    pub details: Vec<MonthlyDetail>,
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

    #[test]
    fn year_month_extracts_prefix() {
        assert_eq!(year_month_of("2026-07-08T06:09:03.964Z").as_deref(), Some("2026-07"));
    }

    #[test]
    fn year_month_rejects_garbage() {
        assert_eq!(year_month_of("not-a-date"), None);
        assert_eq!(year_month_of("2026/07"), None);
        assert_eq!(year_month_of("2026-7"), None);
    }
}
