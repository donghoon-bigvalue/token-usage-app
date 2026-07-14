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
                        let _ = app
                            .notification()
                            .builder()
                            .title("Token Usage")
                            .body(format!("{:?} reached {}%", w.id, t))
                            .show();
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
}
