use crate::model::WindowId;
use crate::settings::Settings;
use crate::usage;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_store::StoreExt;

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
        WindowId::CodexFiveHour => if ko { "현재 5시간" } else { "Current 5-hour" },
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
        loop {
            let settings = load_settings(&app);
            let report = usage::collect().await;
            let _ = app.emit("usage-updated", &report);

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

            tokio::time::sleep(std::time::Duration::from_secs(settings.refresh_interval_secs)).await;
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
    fn notify_text_is_localized_not_debug() {
        let (title_en, body_en) = notify_text(WindowId::ClaudeWeeklyFable, 80, "en");
        assert_eq!(title_en, "Token Usage");
        assert_eq!(body_en, "Current week (Fable) reached 80%");
        let (title_ko, body_ko) = notify_text(WindowId::CodexWeekly, 100, "ko");
        assert_eq!(title_ko, "토큰 사용량");
        assert_eq!(body_ko, "주간 한도이(가) 100%에 도달했어요");
    }
}
