// Library entrypoint — main.rs ve (ileride) mobile target'lar buradan çağırır.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
