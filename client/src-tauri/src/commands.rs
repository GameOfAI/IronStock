use crate::inactivity::InactivityState;
use std::collections::HashMap;
use std::sync::Arc;
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
    match entry.delete_password() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// --- TLS-aware HTTP fetch ---

/// TLS doğrulaması isteğe bağlı bypass edilebilen HTTP komutu.
///
/// Browser `fetch()` TLS sertifika hatalarını geçemez (WebView2 sistem sertifika
/// deposunu kullanır). Geliştirme ortamlarında self-signed sertifikalarla çalışmak
/// için `tls_skip_verify = true` ile bu komut kullanılır.
///
/// ⚠️ `tls_skip_verify = true` sadece geliştirme / dahili ağ kullanımı içindir.
#[tauri::command]
pub async fn tls_fetch(
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
    tls_skip_verify: bool,
) -> Result<TlsFetchResponse, String> {
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(tls_skip_verify)
        .build()
        .map_err(|e| e.to_string())?;

    let http_method: reqwest::Method = method.parse().map_err(|_| format!("Geçersiz HTTP metodu: {method}"))?;
    let mut req = client.request(http_method, &url);

    for (k, v) in &headers {
        req = req.header(k.as_str(), v.as_str());
    }

    if let Some(b) = body {
        req = req.body(b);
    }

    let res = req.send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let text = res.text().await.unwrap_or_default();

    Ok(TlsFetchResponse { status, body: text })
}

#[derive(serde::Serialize)]
pub struct TlsFetchResponse {
    pub status: u16,
    pub body: String,
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
