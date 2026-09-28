/** Güvenlik kayıtlarının okunur Türkçe karşılıkları (web + mobil aynı metinler). */
const EVENT_LABEL: Record<string, string> = {
  login_ok: "Giriş yapıldı",
  login_fail: "Hatalı şifre denemesi",
  "2fa_fail": "Hatalı doğrulama kodu",
  locked: "Hesap geçici olarak kilitlendi",
  password_changed: "Şifre değiştirildi",
  password_change_fail: "Şifre değiştirme denemesi (yanlış şifre)",
  logout_all: "Tüm cihazlardan çıkış yapıldı",
  "2fa_enabled": "İki adımlı doğrulama açıldı",
  "2fa_disabled": "İki adımlı doğrulama kapatıldı",
  "2fa_setup_fail": "2FA kurulumu: yanlış şifre",
  "2fa_disable_fail": "2FA kapatma denemesi başarısız",
  "2fa_codes_fail": "Yedek kod yenileme başarısız",
  "2fa_reset": "2FA yönetici tarafından sıfırlandı",
  backup_codes_renewed: "Yedek kodlar yenilendi",
  founder_created: "Kurucu hesabı oluşturuldu",
  founder_setup_fail: "Kurulum anahtarı yanlış girildi",
  seed_admin_disabled: "Eski yönetici hesabı kapatıldı",
  user_created: "Hesap açıldı",
  user_updated: "Hesap güncellendi",
  user_deleted: "Hesap silindi",
  password_reset: "Şifre sıfırlandı",
  forced_logout: "Oturumları yönetici kapattı",
  unlocked: "Kilit kaldırıldı",
  demo_purged: "Demo verisi silindi",
  setting_changed: "Ayar değiştirildi",
  new_device: "Yeni cihazdan giriş",
  session_closed: "Bir oturum kapatıldı",
};

export function eventLabel(e: string): string {
  return EVENT_LABEL[e] ?? e;
}

export function isBadEvent(e: string): boolean {
  return e.includes("fail") || e === "locked";
}

/** "Mozilla/5.0 (Windows NT 10.0...) Chrome/..." → "Chrome · Windows" */
export function deviceLabel(ua: string | null): string {
  if (!ua) return "Bilinmeyen cihaz";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Safari\//.test(ua)
            ? "Safari"
            : /okhttp|Expo|CFNetwork|Dalvik/i.test(ua)
              ? "Kernel uygulaması"
              : "Tarayıcı";
  const os = /Android/.test(ua)
    ? "Android"
    : /iPhone|iPad|iOS/.test(ua)
      ? "iOS"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return os ? `${browser} · ${os}` : browser;
}

export const PASSWORD_RULES =
  "En az 10 karakter; harf ve rakam/işaret içermeli; adını, numaranı veya yaygın şifreleri (ör. parola123) içermemeli.";
