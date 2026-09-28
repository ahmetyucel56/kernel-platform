# Kernel — KVKK veri envanteri ve teknik tedbirler

Bu belge, okulun bilgi işlem / KVKK birimine OBS entegrasyonu ve pilot kullanım onayı için
sunulmak üzere hazırlanmıştır. Kullanıcılara gösterilen aydınlatma metni uygulamada
`/aydinlatma` sayfasındadır (web ve mobil aynı içerik:
`frontend/src/lib/privacy.ts`).

> **Hukuki gözden geçirme gerekir.** Metinler teknik olarak doğrudur ancak hukuk metni
> değildir; veri sorumlusu, işleme şartları (KVKK m.5) ve yurt dışına aktarım (KVKK m.9)
> kurumun hukuk birimi tarafından değerlendirilmelidir.

## 1. Veri sorumlusu ve iletişim

Render ortam değişkenleriyle ayarlanır (kod değişmeden):

| Değişken | Örnek | Nerede görünür |
| --- | --- | --- |
| `PRIVACY_CONTROLLER` | Tokat Gaziosmanpaşa Üniversitesi — … Bölümü | Aydınlatma metni |
| `PRIVACY_CONTACT` | kvkk@… | Aydınlatma metni (başvuru adresi) |

## 2. İşlenen veriler

| Kategori | Veri | Kimin | Tablo |
| --- | --- | --- | --- |
| Kimlik | Ad soyad, okul/personel no, üniversite, rol, (dahili) e-posta | Öğrenci, akademisyen | `users` |
| Hesap güvenliği | Şifre özeti (bcrypt), 2FA anahtarı, yedek kod özetleri, oturumlar (IP, tarayıcı türü), güvenlik kayıtları | Tüm kullanıcılar | `users`, `user_sessions`, `security_events` |
| Eğitim | Sınıf kayıtları, ödev teslimleri (kod dosyaları ve içerikleri), sürümler, notlar, hoca yorumları, süre uzatmaları | Öğrenci | `enrollments`, `submissions`, `submission_files`, `scores`, `comments`, `assignment_reopens` |
| Yapay zekâ çıktıları | Gereksinim kontrolü, kod kalitesi, ön kontrol, AI mentor sohbetleri | Öğrenci | `ai_analyses`, `prechecks`, `ai_chat_messages` |
| Topluluk | Gönderi, yanıt, oy | Tüm kullanıcılar | `community_*`, `post_votes` |
| Bildirim | Uygulama içi bildirimler | Tüm kullanıcılar | `notifications` |

Özel nitelikli kişisel veri (sağlık, biyometrik vb.) **işlenmez**. T.C. kimlik numarası
**tutulmaz**.

## 3. Nerede saklanıyor / kimlere aktarılıyor

| Hizmet | Amaç | Hangi veri | Bölge |
| --- | --- | --- | --- |
| Supabase (Postgres + Storage) | Veritabanı, yüklenen ZIP'ler | Tümü | *Supabase panelinden doldurulacak* |
| Render | Uygulama sunucusu (API) | Geçici olarak işlenir, kalıcı saklamaz | *Render panelinden doldurulacak* |
| Vercel | Web arayüzü + oturum isteklerinin aktarımı | Oturum çerezi geçer, saklanmaz | Küresel CDN |
| Anthropic (Claude API) | Yapay zekâ analizi | **Yalnızca** kod dosyaları, ödev gereksinimleri, mentor sorusu | ABD |
| GitHub | Kaynak kod + şifreli yedekler (90 gün) | AES-256 ile şifreli veritabanı yedeği | ABD |

Yapay zekâya **ad, okul numarası, e-posta gönderilmez**. Benzerlik (intihal) karşılaştırması
sunucuda yapılır, dışarı gönderilmez. Yapay zekâ yalnızca akademisyen istediğinde (veya
akademisyenin açtığı ön kontrolde öğrenci istediğinde) çalışır.

## 4. Saklama süreleri

| Veri | Süre | Durum |
| --- | --- | --- |
| Güvenlik kayıtları | 1 yıl (`SECURITY_LOG_DAYS`) | Otomatik siliniyor |
| Oturum kayıtları | Bitişten sonra 60 gün | Otomatik siliniyor |
| Şifreli yedekler | 90 gün | Otomatik siliniyor (GitHub) |
| Eğitim verileri | Dönem + itiraz süresi + kurumun belirleyeceği süre | **Planlandı:** dönem sonu arşivi ve süre dolunca silme/anonimleştirme |
| Silinen kullanıcı | Hemen, tüm bağlı verileriyle | Kurucu panelinden "Kalıcı sil" |

## 5. Teknik ve idari tedbirler

- **İletim:** Tüm trafik HTTPS; HSTS açık.
- **Kimlik doğrulama:**
  - Şifreler bcrypt ile saklanır.
  - Güçlü şifre kuralı uygulanır.
  - Hatalı girişte hesap kilidi ve IP sınırı vardır.
  - İki adımlı doğrulama (TOTP) isteğe bağlıdır; yönetici hesabında zorunludur.
- **Oturum:**
  - Web'de oturum JavaScript'in okuyamadığı httpOnly çerezde tutulur; erişim token'ı 15 dakikalıktır.
  - Yeni cihazdan girişte kullanıcıya bildirim gider.
  - Kullanıcı oturumlarını uzaktan kapatabilir.
  - Şifre değişince diğer oturumlar kapanır.
- **Yetkilendirme:**
  - Öğrenci yalnızca kendi verisini görür.
  - Hoca yalnızca kendi sınıflarını görür.
  - Yönetici hesabı tektir ve 2FA zorunludur.
  - Dışarıdan kayıt yoktur; hesapları yönetici açar.
- **Kayıt:** Girişler, hatalı denemeler ve yönetici işlemleri (hesap açma/silme, şifre sıfırlama) kayıt altındadır.
- **Tarayıcı güvenliği:** İçerik güvenlik politikası (CSP) uygulanır, site başka sitelerde çerçevelenemez ve API yanıtları önbelleğe alınmaz.
- **Yedek:** Haftada iki kez alınır ve AES-256 ile şifrelenir (`docs/YEDEKLEME.md`).
- **Demo hesapları:** Gerçek verilere erişemez. Tanıtım bitince tek tuşla silinir.

## 6. İlgili kişi başvuruları (KVKK m.11)

Başvurular `PRIVACY_CONTACT` adresine yapılır ve en geç 30 gün içinde yanıtlanır. Teknik
karşılıkları:

- **Erişim:** Öğrenci kendi teslimlerini, notlarını ve AI sonuçlarını uygulamada görür.
- **Düzeltme:** Ad ve numara bilgisi kurucu panelinden düzeltilir.
- **Silme:** Kurucu panelinden "Kalıcı sil" hesabı ve bağlı tüm verileri siler.

## 7. Açık konular (kurumla netleştirilecek)

1. Veri sorumlusu kim olacak (üniversite / bölüm / proje yürütücüsü)?
2. Yurt dışına aktarım (Anthropic, altyapı sağlayıcıları) için KVKK m.9 kapsamında hangi
   yolun izleneceği (standart sözleşme, bildirim vb.).
3. Eğitim verilerinin saklama süresi (dönem sonu + kaç yıl?).
4. OBS entegrasyonunda hangi alanların aktarılacağı (yalnızca ad, numara ve ders kaydı
   yeterli).
