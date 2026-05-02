mod commands;
mod inactivity;
mod tray;

use inactivity::InactivityState;
use std::sync::Arc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let inactivity = Arc::new(InactivityState::new());
    let inactivity_for_thread = Arc::clone(&inactivity);

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(inactivity)
        .setup(move |app| {
            tray::setup(app)?;

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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
