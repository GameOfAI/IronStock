use crate::inactivity::InactivityState;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tauri::Manager;

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

/// TLS doğrulaması ve mTLS client sertifikası destekli HTTP komutu.
///
/// Browser `fetch()` iki durumda yetersiz kalır:
///   1. TLS sertifika doğrulaması — WebView2 sistem deposunu kullanır, self-signed geçemez.
///   2. mTLS client certificate — tarayıcı WebView2'nin PKCS12 identity'sini programatik
///      olarak ayarlayamaz; Rust reqwest native-tls ile bu mümkündür.
///
/// Parametreler:
///   - `tls_skip_verify`          : true → geliştirme ortamı, self-signed kabul
///   - `client_cert_p12_base64`   : base64-encoded PKCS12 (.p12/.pfx) baytları
///   - `client_cert_password`     : PKCS12 açma parolası (boş string kabul edilir)
///
/// ⚠️ `tls_skip_verify = true` sadece geliştirme / dahili ağ kullanımı içindir.
#[tauri::command]
pub async fn tls_fetch(
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
    tls_skip_verify: bool,
    client_cert_p12_base64: Option<String>,
    client_cert_password: Option<String>,
) -> Result<TlsFetchResponse, String> {
    use base64::Engine as _;

    let mut builder = reqwest::Client::builder()
        .danger_accept_invalid_certs(tls_skip_verify);

    // mTLS: PKCS12 client sertifikası yükle.
    if let Some(p12_b64) = client_cert_p12_base64.filter(|s| !s.is_empty()) {
        let p12_bytes = base64::engine::general_purpose::STANDARD
            .decode(&p12_b64)
            .map_err(|e| format!("Client sertifikası (base64) çözülemedi: {e}"))?;

        let password = client_cert_password.unwrap_or_default();

        let identity = reqwest::Identity::from_pkcs12_der(&p12_bytes, &password)
            .map_err(|e| format!("Client sertifikası (.p12) yüklenemedi: {e}"))?;

        builder = builder.identity(identity);
    }

    let client = builder.build().map_err(|e| e.to_string())?;

    let http_method: reqwest::Method =
        method.parse().map_err(|_| format!("Geçersiz HTTP metodu: {method}"))?;
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

// --- Offline cache commands ---
//
// Query cache'i app veri dizinine (AppData/envanter-client/cache/) JSON dosyaları
// olarak yazar. Her "slot" için tek bir dosya kullanılır (genellikle "queries.json").
// Bu komutlar offline mod için TanStack Query cache'ini persist etmek amacıyla kullanılır.

/// Bir önbellek slotuna veri yazar. `slot` dosya adının güvenli bileşenidir ("queries", vb.).
/// Veriler AppData/envanter-client/cache/<slot>.json dosyasına yazılır.
#[tauri::command]
pub async fn cache_write(app: tauri::AppHandle, slot: String, data: String) -> Result<(), String> {
    use base64::Engine as _;
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("Cache dizini alınamadı: {e}"))?;
    std::fs::create_dir_all(&cache_dir)
        .map_err(|e| format!("Cache dizini oluşturulamadı: {e}"))?;
    // Slot adını URL-safe base64 ile encode et — filesystem-safe karakter garantisi.
    let safe_name = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(slot.as_bytes());
    let path = cache_dir.join(format!("{safe_name}.json"));
    std::fs::write(&path, data.as_bytes())
        .map_err(|e| format!("Cache yazılamadı: {e}"))
}

/// Bir önbellek slotunu okur. Dosya yoksa None döner; hata durumunda Err döner.
#[tauri::command]
pub async fn cache_read(app: tauri::AppHandle, slot: String) -> Result<Option<String>, String> {
    use base64::Engine as _;
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("Cache dizini alınamadı: {e}"))?;
    let safe_name = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(slot.as_bytes());
    let path = cache_dir.join(format!("{safe_name}.json"));
    match std::fs::read_to_string(&path) {
        Ok(data) => Ok(Some(data)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Cache okunamadı: {e}")),
    }
}

/// Tüm önbellek slotlarını temizler (çıkış, hesap değişikliği, vb. için).
#[tauri::command]
pub async fn cache_clear(app: tauri::AppHandle) -> Result<(), String> {
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("Cache dizini alınamadı: {e}"))?;
    if !cache_dir.exists() {
        return Ok(());
    }
    let entries = std::fs::read_dir(&cache_dir)
        .map_err(|e| format!("Cache dizini okunamadı: {e}"))?;
    for entry in entries.flatten() {
        if entry.path().extension().is_some_and(|ext| ext == "json") {
            let _ = std::fs::remove_file(entry.path());
        }
    }
    Ok(())
}

// --- Screen capture protection ---

/// Pencereyi ekran yakalama (screen share/record) uygulamalarından gizler.
///
/// Windows  : `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` — pencere
///            içeriği ekran kaydı/paylaşım yazılımında siyah görünür.
/// macOS    : `[NSWindow setSharingType: NSWindowSharingNone]` — içerik
///            ekran paylaşımında gizlenir.
///
/// `enabled = true`  → ekran yakalamadan gizle (varsayılan, güvenli mod)
/// `enabled = false` → normal davranış (kullanıcı devre dışı bıraktı)
#[tauri::command]
pub fn set_content_protection(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Ana pencere bulunamadı".to_string())?;
    window
        .set_content_protected(enabled)
        .map_err(|e| e.to_string())
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
