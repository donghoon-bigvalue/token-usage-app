//! Cross-restart cache of the last *good* usage snapshot per provider.
//!
//! Claude usage is a remote-only resource, so a cold start can't paint it until
//! a network round-trip finishes. We keep the last error-free snapshot in memory
//! (`LastGood`), seed it from disk at startup, and flush it back on exit, so the
//! next launch can show it instantly (labeled as cached) while the live fetch
//! runs. This is a tray app — the process is long-lived — so once-at-exit is the
//! right write cadence.

use crate::model::{Source, UsageSnapshot};
use crate::usage::UsageReport;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "usage-cache.json";
const KEY: &str = "report";

/// In-memory holder for the last error-free report, one snapshot per provider.
/// Seeded from disk at startup, updated by the poller, flushed to disk at exit.
#[derive(Default)]
pub struct LastGood(pub Mutex<Option<UsageReport>>);

impl LastGood {
    /// Fold a freshly-collected report in, keeping the previous snapshot for any
    /// provider whose fresh snapshot carries an error (so a Claude blip doesn't
    /// wipe Codex's good data, and vice versa).
    pub fn update(&self, fresh: &UsageReport) {
        let mut g = self.0.lock().unwrap();
        *g = Some(merge_persisted(g.as_ref(), fresh));
    }

    /// The held report with every snapshot marked `Source::Cache`, or `None` if
    /// nothing good has been seen yet.
    pub fn as_cache(&self) -> Option<UsageReport> {
        self.0.lock().unwrap().as_ref().map(as_cache)
    }
}

/// Per provider: take `fresh` when it has data (no error), else fall back to the
/// matching provider in `prev`. With no `prev` and an errored `fresh`, there is
/// nothing better to return, so `fresh` is used as-is.
pub fn merge_persisted(prev: Option<&UsageReport>, fresh: &UsageReport) -> UsageReport {
    UsageReport {
        claude: pick(prev.map(|p| &p.claude), &fresh.claude),
        codex: pick(prev.map(|p| &p.codex), &fresh.codex),
    }
}

fn pick(prev: Option<&UsageSnapshot>, fresh: &UsageSnapshot) -> UsageSnapshot {
    if fresh.error.is_none() {
        fresh.clone()
    } else {
        prev.cloned().unwrap_or_else(|| fresh.clone())
    }
}

fn as_cache(r: &UsageReport) -> UsageReport {
    let mut out = r.clone();
    out.claude.source = Source::Cache;
    out.codex.source = Source::Cache;
    out
}

/// Read the persisted report from disk (best-effort; `None` on any failure).
pub fn read_disk(app: &AppHandle) -> Option<UsageReport> {
    let store = app.store(STORE_FILE).ok()?;
    let value = store.get(KEY)?;
    serde_json::from_value(value).ok()
}

/// Load the disk cache into the in-memory holder. Called once at startup.
pub fn seed(app: &AppHandle) {
    let Some(report) = read_disk(app) else { return };
    if let Some(state) = app.try_state::<LastGood>() {
        *state.0.lock().unwrap() = Some(report);
    }
}

/// Write the in-memory holder back to disk (best-effort). Called once at exit.
pub fn flush(app: &AppHandle) {
    let Some(state) = app.try_state::<LastGood>() else { return };
    let held = state.0.lock().unwrap().clone();
    let Some(report) = held else { return };
    if let Ok(store) = app.store(STORE_FILE) {
        if let Ok(value) = serde_json::to_value(&report) {
            store.set(KEY, value);
            let _ = store.save();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::ProviderId;

    fn snap(provider: ProviderId, updated_at: i64, error: Option<&str>) -> UsageSnapshot {
        UsageSnapshot {
            provider,
            plan: "Max".into(),
            plan_raw: "max".into(),
            source: Source::Live,
            updated_at,
            windows: vec![],
            error: error.map(|s| s.to_string()),
        }
    }
    fn report(claude: UsageSnapshot, codex: UsageSnapshot) -> UsageReport {
        UsageReport { claude, codex }
    }

    #[test]
    fn merge_takes_fresh_when_both_good() {
        let prev = report(snap(ProviderId::Claude, 1, None), snap(ProviderId::Codex, 1, None));
        let fresh = report(snap(ProviderId::Claude, 2, None), snap(ProviderId::Codex, 2, None));
        let m = merge_persisted(Some(&prev), &fresh);
        assert_eq!(m.claude.updated_at, 2);
        assert_eq!(m.codex.updated_at, 2);
    }

    #[test]
    fn merge_keeps_prev_for_errored_provider_only() {
        // Claude fails this round, Codex succeeds → keep prev Claude, take fresh Codex.
        let prev = report(snap(ProviderId::Claude, 1, None), snap(ProviderId::Codex, 1, None));
        let fresh = report(
            snap(ProviderId::Claude, 2, Some("request failed")),
            snap(ProviderId::Codex, 2, None),
        );
        let m = merge_persisted(Some(&prev), &fresh);
        assert_eq!(m.claude.updated_at, 1); // preserved
        assert!(m.claude.error.is_none());
        assert_eq!(m.codex.updated_at, 2); // updated
    }

    #[test]
    fn merge_uses_fresh_when_no_prev_even_if_errored() {
        let fresh = report(
            snap(ProviderId::Claude, 2, Some("credentials not found")),
            snap(ProviderId::Codex, 2, None),
        );
        let m = merge_persisted(None, &fresh);
        assert_eq!(m.claude.error.as_deref(), Some("credentials not found"));
    }

    #[test]
    fn as_cache_marks_both_snapshots_cache() {
        let r = report(snap(ProviderId::Claude, 1, None), snap(ProviderId::Codex, 1, None));
        let c = as_cache(&r);
        assert_eq!(c.claude.source, Source::Cache);
        assert_eq!(c.codex.source, Source::Cache);
    }
}
