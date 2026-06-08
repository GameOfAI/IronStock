mod commands;
mod inactivity;
mod tray;

use inactivity::InactivityState;
use std::sync::Arc;
use tauri::{Manager, RunEvent, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let inactivity = Arc::new(InactivityState::new());
    let inactivity_for_thread = Arc::clone(&inactivity);

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(inactivity)
        .setup(move |app| {
            tray::setup(app)?;

            // Ekran yakalama korumasını varsayılan olarak etkinleştir.
            // JS katmanı hydration sonrası kullanıcı tercihini uygulayarak override edebilir.
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_content_protected(false);
            }

            let handle = app.handle().clone();
            let last = Arc::clone(&inactivity_for_thread.last_activity);
            let timeout = Arc::clone(&inactivity_for_thread.timeout_secs);
            inactivity::start(handle, last, timeout);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::kek_store,
            commands::kek_load,
            commands::kek_delete,
            commands::activity_ping,
            commands::set_inactivity_timeout,
            commands::tls_fetch,
            commands::cache_write,
            commands::cache_read,
            commands::cache_clear,
            commands::set_content_protection,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| match event {
        // macOS: Pencere kapatıldığında uygulamayı tamamen kapatma,
        // tray ikonundan "Göster" ile yeniden açılabilsin.
        RunEvent::WindowEvent {
            event: WindowEvent::CloseRequested { api, .. },
            label,
            ..
        } => {
            // Pencereyi gizle, uygulamayı kapatma.
            api.prevent_close();
            if let Some(win) = app_handle.get_webview_window(&label) {
                let _ = win.hide();
            }
        }
        // macOS: Dock ikonuna tıklandığında pencereyi tekrar göster.
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => {
            if let Some(win) = app_handle.get_webview_window("main") {
                let _ = win.show();
                let _ = win.set_focus();
            }
        }
        _ => {}
    });
}
