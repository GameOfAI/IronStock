use crate::inactivity::InactivityState;
use std::sync::{Arc, Mutex};
use std::time::Instant;

const KEYRING_SERVICE: &str = "app.envanter.client";

// --- Keyring commands ---

/// Kullanıcının KEK'ini OS keyring'e (Windows Credential Manager / macOS Keychain) kaydeder.
/// kek_base64: base64-encoded 32-byte KEK.
#[tauri::command]
pub fn kek_store(username: String, kek_base64: String) -> Result<(), String> {
    keyring::Entry::new(KEYRING_SERVICE, &username)
        .map_err(|e| e.to_string())?
        .set_password(&kek_base64)
        .map_err(|e| e.to_string())
}

/// OS keyring'den KEK'i yükler. Kayıt yoksa None döner.
#[tauri::command]
pub fn kek_load(username: String) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &username).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(pw) => Ok(Some(pw)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// OS keyring'den KEK'i siler. Kayıt yoksa sessizce devam eder.
#[tauri::command]
pub fn kek_delete(username: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &username).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// --- Inactivity commands ---

/// Frontend her kullanıcı aktivitesinde bu komutu çağırır; Rust timer'ı sıfırlar.
#[tauri::command]
pub fn activity_ping(state: tauri::State<Arc<InactivityState>>) {
    *state.last_activity.lock().unwrap() = Instant::now();
}

/// İnaktif kalma süresini saniye cinsinden günceller (varsayılan: 600 = 10dk).
#[tauri::command]
pub fn set_inactivity_timeout(state: tauri::State<Arc<InactivityState>>, secs: u64) {
    *state.timeout_secs.lock().unwrap() = secs;
}
