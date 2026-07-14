mod model;
mod providers;
mod settings;
mod usage;
mod commands;
mod poller;

use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_usage,
            commands::get_settings,
            commands::set_settings,
        ])
        .setup(|app| {
            poller::start(app.handle().clone());

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click { .. } = event {
                        if let Some(win) = tray.app_handle().get_webview_window("main") {
                            let _ = if win.is_visible().unwrap_or(false) {
                                win.hide()
                            } else {
                                win.show().and_then(|_| win.set_focus())
                            };
                        }
                    }
                })
                .build(app)?;

            if let Some(win) = app.get_webview_window("main") {
                let handle = app.handle().clone();
                win.on_window_event(move |e| {
                    if let WindowEvent::Focused(true) = e {
                        let h = handle.clone();
                        tauri::async_runtime::spawn(async move {
                            let report = crate::usage::collect().await;
                            let _ = h.emit("usage-updated", &report);
                        });
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
