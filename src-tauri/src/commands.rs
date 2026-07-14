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
    let store = app.store(STORE_FILE).expect("store");
    match store.get(KEY) {
        Some(v) => serde_json::from_value(v).map(sanitize).unwrap_or_default(),
        None => Settings::default(),
    }
}

#[tauri::command]
pub fn set_settings(app: AppHandle, settings: Settings) -> Settings {
    let clean = sanitize(settings);
    let store = app.store(STORE_FILE).expect("store");
    store.set(KEY, serde_json::to_value(&clean).unwrap());
    let _ = store.save();
    clean
}
