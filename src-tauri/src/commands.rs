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
