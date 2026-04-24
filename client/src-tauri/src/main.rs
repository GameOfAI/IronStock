// Envanter desktop client — Tauri 2 entrypoint.
// Gerçek implementation Faz 4'te.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    envanter_client_lib::run()
}
