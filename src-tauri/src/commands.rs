use crate::model::UsageHistory;
use crate::settings::{sanitize, Settings};
use crate::usage::{self, UsageReport};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "settings.json";
const KEY: &str = "settings";

#[tauri::command]
pub async fn get_usage() -> UsageReport {
    usage::collect().await
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Settings {
    // Degrade to defaults if the store can't be opened (disk/permission/corruption)
    // rather than panicking the command.
    let Ok(store) = app.store(STORE_FILE) else {
        return Settings::default();
    };
    match store.get(KEY) {
        Some(v) => serde_json::from_value(v).map(sanitize).unwrap_or_default(),
        None => Settings::default(),
    }
}

#[tauri::command]
pub fn set_settings(app: AppHandle, settings: Settings) -> Settings {
    let clean = sanitize(settings);
    // Persist best-effort; a store/serialization failure returns the sanitized
    // value to the caller without panicking.
    if let Ok(store) = app.store(STORE_FILE) {
        if let Ok(value) = serde_json::to_value(&clean) {
            store.set(KEY, value);
            let _ = store.save();
        }
    }
    clean
}

/// In-memory cache of the aggregated usage history for the app session
/// (issue #19 §6). Populated on first `get_usage_history` call and reused
/// until an explicit `refresh` is requested.
#[derive(Default)]
pub struct UsageCache(pub std::sync::Mutex<Option<UsageHistory>>);

#[tauri::command]
pub async fn get_usage_history(
    cache: tauri::State<'_, UsageCache>,
    refresh: bool,
) -> Result<UsageHistory, String> {
    if !refresh {
        if let Some(h) = cache.0.lock().unwrap().clone() {
            return Ok(h);
        }
    }
    // Disk scan runs off the main thread so the UI never freezes on a
    // large history.
    let history = tokio::task::spawn_blocking(crate::history::build_history)
        .await
        .map_err(|e| e.to_string())?;
    *cache.0.lock().unwrap() = Some(history.clone());
    Ok(history)
}

#[tauri::command]
pub async fn export_usage_csv(
    cache: tauri::State<'_, UsageCache>,
    path: String,
) -> Result<(), String> {
    let cached = cache.0.lock().unwrap().clone();
    let history = match cached {
        Some(h) => h,
        None => tokio::task::spawn_blocking(crate::history::build_history)
            .await
            .map_err(|e| e.to_string())?,
    };
    let csv = crate::history::to_csv(&history);
    std::fs::write(&path, csv).map_err(|e| e.to_string())
}
