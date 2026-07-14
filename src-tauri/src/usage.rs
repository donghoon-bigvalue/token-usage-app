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
        claude: c.unwrap_or_else(|e| error_snapshot(ProviderId::Claude, e.user_message().to_string())),
        codex: x.unwrap_or_else(|e| error_snapshot(ProviderId::Codex, e.user_message().to_string())),
    }
}

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
