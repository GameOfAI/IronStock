use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    Emitter, Manager,
};

/// Sistem tepsisi ikonunu ve menüsünü kurar.
/// Menü öğeleri: Göster | Kilitle | Çıkış
pub fn setup<R: tauri::Runtime>(app: &tauri::App<R>) -> tauri::Result<()> {
    let show_item = MenuItemBuilder::with_id("show", "Göster").build(app)?;
    let lock_item = MenuItemBuilder::with_id("lock", "Kilitle").build(app)?;
    let quit_item = MenuItemBuilder::with_id("quit", "Çıkış").build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&show_item)
        .item(&lock_item)
        .separator()
        .item(&quit_item)
        .build()?;

    // Uygulama ikonu varsa onu kullan, yoksa minimal RGBA fallback.
    let icon = app
        .default_window_icon()
        .cloned()
        .unwrap_or_else(make_fallback_icon);

    TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .tooltip("IronStock")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "lock" => {
                // Frontend'e kilit eventi gönder — auth store clear eder.
                let _ = app.emit("inactivity_lock", ());
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    Ok(())
}

/// Hiç ikon tanımlanmamışsa 16×16 mavi RGBA ikonu döner.
fn make_fallback_icon() -> tauri::image::Image<'static> {
    // 16×16 px — RGBA (R=30, G=100, B=180, A=255): koyu mavi kare
    let rgba: Vec<u8> = (0..16 * 16).flat_map(|_| [30u8, 100, 180, 255]).collect();
    tauri::image::Image::new_owned(rgba, 16, 16)
}
