use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::Manager;

pub struct InactivityState {
    pub last_activity: Arc<Mutex<Instant>>,
    pub timeout_secs: Arc<Mutex<u64>>,
}

impl InactivityState {
    pub fn new() -> Self {
        Self {
            last_activity: Arc::new(Mutex::new(Instant::now())),
            timeout_secs: Arc::new(Mutex::new(600)), // 10 dakika
        }
    }
}

/// Arka plan thread'i: her 30 saniyede bir inaktiflik kontrolü yapar.
/// Süre dolduğunda frontend'e `inactivity_lock` eventi gönderilir.
pub fn start<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    last_activity: Arc<Mutex<Instant>>,
    timeout_secs: Arc<Mutex<u64>>,
) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(30));

        let timeout = Duration::from_secs(*timeout_secs.lock().unwrap());
        let elapsed = last_activity.lock().unwrap().elapsed();

        if elapsed >= timeout {
            let _ = app_handle.emit("inactivity_lock", ());
            // Timer'ı sıfırla — kullanıcı /login'e gidene kadar tekrar tetiklenmesin.
            *last_activity.lock().unwrap() = Instant::now();
        }
    });
}
