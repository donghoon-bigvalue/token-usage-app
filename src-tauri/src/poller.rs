use crate::model::WindowId;
use crate::settings::Settings;
use crate::usage;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_store::StoreExt;

/// Never let backoff push the poll interval past this.
const MAX_BACKOFF: Duration = Duration::from_secs(30 * 60);

/// The delay before the next poll after a rate-limit. Honors an explicit
/// `Retry-After` (but never polls faster than the normal cadence); absent one,
/// backs off exponentially on `base` by the consecutive-429 `streak` (≥1).
/// Clamped to `max`.
pub fn backoff_delay(
    base: Duration,
    retry_after: Option<Duration>,
    streak: u32,
    max: Duration,
) -> Duration {
    let d = match retry_after {
        Some(ra) => ra.max(base),
        None => {
            let shift = streak.saturating_sub(1).min(6); // cap exponential growth at 64x
            base.saturating_mul(1u32 << shift)
        }
    };
    d.min(max)
}

pub fn crossed_thresholds(prev: Option<f64>, now: f64, thresholds: &[u8]) -> Vec<u8> {
    thresholds
        .iter()
        .copied()
        .filter(|&t| now >= t as f64 && prev.map(|p| p < t as f64).unwrap_or(true))
        .collect()
}

/// Localized window label — mirrors the frontend `window.*` i18n strings so the
/// notification reads the same as the in-app label (not a raw enum name).
fn window_label(id: WindowId, lang: &str) -> &'static str {
    let ko = lang == "ko";
    match id {
        WindowId::ClaudeSession => if ko { "현재 세션" } else { "Current session" },
        WindowId::ClaudeWeeklyAll => if ko { "이번 주 (전체 모델)" } else { "Current week (all models)" },
        WindowId::ClaudeWeeklyFable => if ko { "이번 주 (Fable)" } else { "Current week (Fable)" },
        WindowId::CodexWeekly => if ko { "주간 한도" } else { "Weekly limit" },
        WindowId::CodexSparkWeekly => if ko { "Spark 주간 한도" } else { "Spark weekly limit" },
    }
}

/// Localized notification (title, body) for a threshold crossing.
fn notify_text(id: WindowId, percent: u8, lang: &str) -> (String, String) {
    let label = window_label(id, lang);
    if lang == "ko" {
        ("토큰 사용량".to_string(), format!("{label}이(가) {percent}%에 도달했어요"))
    } else {
        ("Token Usage".to_string(), format!("{label} reached {percent}%"))
    }
}

fn load_settings(app: &AppHandle) -> Settings {
    let store = match app.store("settings.json") {
        Ok(s) => s,
        Err(_) => return Settings::default(),
    };
    store
        .get("settings")
        .and_then(|v| serde_json::from_value(v).ok())
        .map(crate::settings::sanitize)
        .unwrap_or_default()
}

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // 윈도우별 직전 퍼센트 기억 (id 문자열 → percent)
        let last: Mutex<HashMap<String, f64>> = Mutex::new(HashMap::new());
        // 연속 429 횟수 — 지수 백오프 계산용. 성공하면 0으로 리셋.
        let mut rl_streak: u32 = 0;
        loop {
            let settings = load_settings(&app);
            let collected = usage::collect_detailed().await;
            let report = &collected.report;
            let _ = app.emit("usage-updated", report);

            // 알림 판정
            for snap in [&report.claude, &report.codex] {
                for w in &snap.windows {
                    if !w.available {
                        continue;
                    }
                    let key = format!("{:?}", w.id);
                    let prev = last.lock().unwrap().get(&key).copied();
                    let fired = crossed_thresholds(prev, w.used_percent, &settings.notify_thresholds);
                    for t in fired {
                        let (title, body) = notify_text(w.id, t, &settings.language);
                        let _ = app.notification().builder().title(title).body(body).show();
                    }
                    last.lock().unwrap().insert(key, w.used_percent);
                }
            }

            // rate limit이면 백오프, 아니면 정상 주기로 복귀.
            let base = Duration::from_secs(settings.refresh_interval_secs);
            let wait = if collected.rate_limited {
                rl_streak = rl_streak.saturating_add(1);
                let hint = collected.retry_after_secs.map(Duration::from_secs);
                backoff_delay(base, hint, rl_streak, MAX_BACKOFF)
            } else {
                rl_streak = 0;
                base
            };
            tokio::time::sleep(wait).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_upward_crossing() {
        assert_eq!(crossed_thresholds(Some(75.0), 82.0, &[80, 100]), vec![80]);
    }
    #[test]
    fn no_crossing_when_below() {
        assert_eq!(crossed_thresholds(Some(50.0), 60.0, &[80, 100]), Vec::<u8>::new());
    }
    #[test]
    fn first_reading_above_threshold_fires() {
        assert_eq!(crossed_thresholds(None, 100.0, &[80, 100]), vec![80, 100]);
    }
    #[test]
    fn no_refire_when_already_above() {
        assert_eq!(crossed_thresholds(Some(85.0), 90.0, &[80, 100]), Vec::<u8>::new());
    }

    #[test]
    fn backoff_honors_retry_after_but_not_below_base() {
        let base = Duration::from_secs(60);
        let max = Duration::from_secs(1800);
        // Server hint above base → honored.
        assert_eq!(backoff_delay(base, Some(Duration::from_secs(120)), 1, max), Duration::from_secs(120));
        // Server hint below base → clamp up to base (never poll faster than normal).
        assert_eq!(backoff_delay(base, Some(Duration::from_secs(10)), 1, max), base);
        // Server hint above max → clamp to max.
        assert_eq!(backoff_delay(base, Some(Duration::from_secs(9999)), 1, max), max);
    }

    #[test]
    fn backoff_grows_exponentially_without_header() {
        let base = Duration::from_secs(60);
        let max = Duration::from_secs(1800);
        assert_eq!(backoff_delay(base, None, 1, max), Duration::from_secs(60)); // 1x
        assert_eq!(backoff_delay(base, None, 2, max), Duration::from_secs(120)); // 2x
        assert_eq!(backoff_delay(base, None, 3, max), Duration::from_secs(240)); // 4x
        assert_eq!(backoff_delay(base, None, 4, max), Duration::from_secs(480)); // 8x
        // Far-out streak clamps to max, never overflows.
        assert_eq!(backoff_delay(base, None, 100, max), max);
    }

    #[test]
    fn notify_text_is_localized_not_debug() {
        let (title_en, body_en) = notify_text(WindowId::ClaudeWeeklyFable, 80, "en");
        assert_eq!(title_en, "Token Usage");
        assert_eq!(body_en, "Current week (Fable) reached 80%");
        let (title_ko, body_ko) = notify_text(WindowId::CodexWeekly, 100, "ko");
        assert_eq!(title_ko, "토큰 사용량");
        assert_eq!(body_ko, "주간 한도이(가) 100%에 도달했어요");
    }
}
