use crate::model::{LimitWindow, ProviderId, Source, UsageSnapshot, WindowId};
use crate::providers::{claude, codex};
use serde::Serialize;
use std::sync::LazyLock;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

#[derive(Serialize, Clone)]
pub struct UsageReport {
    pub claude: UsageSnapshot,
    pub codex: UsageSnapshot,
}

/// Single-flight cache that coalesces bursty `collect()` calls. At startup the
/// initial `fetchUsage()`, the poller's first tick, and the window-focus handler
/// all fire within a moment of each other, and the Claude usage endpoint
/// rate-limits aggressively (429). Holding the lock across the fetch serializes
/// callers, and the short TTL means a burst produces exactly one upstream fetch
/// — the rest reuse its result. Intentional refreshes spaced beyond the TTL
/// still hit the network.
static CACHE: LazyLock<Mutex<Option<(Instant, Collected)>>> = LazyLock::new(|| Mutex::new(None));
const MIN_REFRESH: Duration = Duration::from_secs(5);

/// A collection carrying a *recoverable* error (a cold-start network blip, a
/// refresh that momentarily 401'd before the token settled) is cached only
/// briefly — long enough to still coalesce the concurrent startup burst, but
/// short enough that the next manual refresh or poll retries promptly instead of
/// being pinned to the stale error for the full `MIN_REFRESH`. Without this, a
/// transient failure at launch stuck the sign-in prompt on screen for 5s and
/// forced the user to "refresh a few times" to recover (issue #53).
const ERROR_REFRESH: Duration = Duration::from_secs(1);

/// The provider `user_message` for genuinely-absent credentials. This error is
/// *stable* (missing creds won't reappear within seconds), so it keeps the full
/// TTL; every other error is treated as transient. Kept in sync with the
/// frontend's `AUTH_ERROR` sentinel so both layers agree on what "sign in" means.
const AUTH_ERROR: &str = "credentials not found";

/// True when a snapshot failed for a reason worth retrying soon — anything other
/// than a stable "no credentials" auth error.
fn is_transient_error(snap: &UsageSnapshot) -> bool {
    matches!(snap.error.as_deref(), Some(e) if e != AUTH_ERROR)
}

/// How long this result may be served from the single-flight cache. A rate-limit
/// keeps the full TTL so rapid manual refreshes can't hammer a 429 (the poller
/// backs off separately); a transient error gets the short TTL so recovery is
/// quick; success and a stable auth error keep the full TTL.
fn cache_ttl(c: &Collected) -> Duration {
    if !c.rate_limited
        && (is_transient_error(&c.report.claude) || is_transient_error(&c.report.codex))
    {
        ERROR_REFRESH
    } else {
        MIN_REFRESH
    }
}

/// A collected usage report plus rate-limit scheduling hints for the poller.
#[derive(Clone)]
pub struct Collected {
    pub report: UsageReport,
    /// A provider returned HTTP 429 this round.
    pub rate_limited: bool,
    /// Server `Retry-After` hint in seconds, when one was provided.
    pub retry_after_secs: Option<u64>,
}

pub fn error_snapshot(provider: ProviderId, msg: String) -> UsageSnapshot {
    let windows = match provider {
        ProviderId::Claude => vec![
            LimitWindow::unavailable(WindowId::ClaudeSession),
            LimitWindow::unavailable(WindowId::ClaudeWeeklyAll),
            LimitWindow::unavailable(WindowId::ClaudeWeeklyFable),
        ],
        ProviderId::Codex => vec![
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

/// Fetch both providers concurrently and normalize failures into error snapshots,
/// capturing whether Claude rate-limited us (Codex is local-only and never does).
async fn collect_fresh() -> Collected {
    let (c, x) = tokio::join!(claude::get(), codex::get());
    let mut rate_limited = false;
    let mut retry_after_secs = None;
    let claude = match c {
        Ok(s) => s,
        Err(e) => {
            if let claude::ClaudeError::RateLimited { retry_after } = &e {
                rate_limited = true;
                retry_after_secs = *retry_after;
            }
            error_snapshot(ProviderId::Claude, e.user_message().to_string())
        }
    };
    let codex = x.unwrap_or_else(|e| error_snapshot(ProviderId::Codex, e.user_message().to_string()));
    Collected {
        report: UsageReport { claude, codex },
        rate_limited,
        retry_after_secs,
    }
}

/// Like [`collect`] but also returns rate-limit hints (used by the poller for backoff).
pub async fn collect_detailed() -> Collected {
    // Single-flight: hold the lock across the fetch so concurrent callers wait
    // and then observe the just-cached result instead of firing their own request.
    let mut guard = CACHE.lock().await;
    if let Some((at, collected)) = guard.as_ref() {
        if at.elapsed() < cache_ttl(collected) {
            return collected.clone();
        }
    }
    let collected = collect_fresh().await;
    *guard = Some((Instant::now(), collected.clone()));
    collected
}

pub async fn collect() -> UsageReport {
    collect_detailed().await.report
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
        // Codex 자리표시 윈도우 2개(weekly, spark) 모두 unavailable
        assert_eq!(s.windows.len(), 2);
        assert!(s.windows.iter().all(|w| !w.available));
        assert!(s.windows.iter().any(|w| w.id == WindowId::CodexSparkWeekly));
    }

    #[test]
    fn error_snapshot_claude_windows() {
        let s = error_snapshot(ProviderId::Claude, "x".into());
        assert_eq!(s.windows.len(), 3);
        assert!(s.windows.iter().any(|w| w.id == WindowId::ClaudeWeeklyFable));
    }

    fn ok_snap(provider: ProviderId) -> UsageSnapshot {
        UsageSnapshot {
            provider,
            plan: "Max".into(),
            plan_raw: "max".into(),
            source: Source::Live,
            updated_at: 0,
            windows: vec![],
            error: None,
        }
    }

    fn collected(claude: UsageSnapshot, codex: UsageSnapshot, rate_limited: bool) -> Collected {
        Collected {
            report: UsageReport { claude, codex },
            rate_limited,
            retry_after_secs: None,
        }
    }

    #[test]
    fn cache_ttl_short_for_transient_error() {
        // A cold-start network blip surfaces as "request failed" — retry soon.
        let c = collected(
            error_snapshot(ProviderId::Claude, "request failed".into()),
            ok_snap(ProviderId::Codex),
            false,
        );
        assert_eq!(cache_ttl(&c), ERROR_REFRESH);
    }

    #[test]
    fn cache_ttl_full_for_success() {
        let c = collected(ok_snap(ProviderId::Claude), ok_snap(ProviderId::Codex), false);
        assert_eq!(cache_ttl(&c), MIN_REFRESH);
    }

    #[test]
    fn cache_ttl_full_for_stable_auth_error() {
        // Genuinely-missing credentials are stable — keep the full TTL (burst
        // protection) rather than re-fetching every second. A Codex-only-absent
        // user must not lose Claude's coalescing.
        let c = collected(
            ok_snap(ProviderId::Claude),
            error_snapshot(ProviderId::Codex, "credentials not found".into()),
            false,
        );
        assert_eq!(cache_ttl(&c), MIN_REFRESH);
    }

    #[test]
    fn cache_ttl_full_when_rate_limited() {
        // Rate-limit → honor backoff; don't let manual refresh hammer a 429 even
        // though its message ("request failed") looks transient.
        let c = collected(
            error_snapshot(ProviderId::Claude, "request failed".into()),
            ok_snap(ProviderId::Codex),
            true,
        );
        assert_eq!(cache_ttl(&c), MIN_REFRESH);
    }
}
