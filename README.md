# Kernel — Yapay Zekâ Destekli Ödev Değerlendirme ve Mentorluk Platformu

Kernel, programlama derslerinde öğrencilerin ödevlerini teslim ettiği, akademisyenin
bu teslimleri tek ekranda inceleyip notlandırdığı bir web ve mobil platformdur.
Yapay zekâ **yalnızca akademisyen istediğinde** çalışır ve kararı her zaman
akademisyene bırakır: not veren yapay zekâ değil, hocadır.

> **Bu depo yalnızca inceleme amacıyla (ders değerlendirmesi, portfolyo) herkese açıktır.**
> Açık kaynak değildir; kurulum ve çalıştırma talimatı paylaşılmamaktadır.
> Kod izinsiz kopyalanamaz, kullanılamaz veya çalıştırılamaz — bkz. [LICENSE](LICENSE).

Geliştirme: Tokat Gaziosmanpaşa Üniversitesi, Bilgisayar Teknolojileri Bölümü —
Mesleki Çözümleme I dersi projesi.

## Çözdüğü problem

- Bir akademisyen onlarca öğrencinin çok dosyalı projesini aynı kurallara göre tek tek
  açıp incelemek zorunda kalır; süreç uzun sürer ve tutarsızlaşır.
- Öğrenci, ödevin hangi gereksinimini eksik bıraktığını çoğu zaman not açıklanınca öğrenir.
- Kopya (benzer kod) tespiti elle neredeyse imkânsızdır; genel amaçlı yapay zekâ araçları ise
  öğrenciye doğrudan çözüm yazarak öğrenmeyi zayıflatabilir.

## Özellikler

**Akademisyen**
- Sınıf ve ödev yönetimi; ödev metninden gereksinimleri otomatik çıkarma
- Tüm sınıfın teslim durumu, notlanmayı bekleyenler ve benzerlik uyarıları tek ekranda
- İstek üzerine **gereksinim kontrolü**: her kural öğrencinin kodunda tek tek, kanıtıyla
  (dosya / fonksiyon) "tam / kısmen / yok" olarak raporlanır
- İstek üzerine **kod kalitesi (Clean Code)** analizi ve sınıf geneli yapay zekâ özeti
- **Benzerlik (kopya) kontrolü** — sunucuda yapılır, değişken adları değişse de yakalar
- Satır bazlı yorum, yapay zekâ destekli not önerisi (notu hoca verir), Excel'e not aktarımı
- Teslim süresini uzatma / öne çekme / hemen bitirme, öğrenciye özel süre
- Yapay zekâ sonuçlarından hangilerini öğrencinin göreceğine karar verme

**Öğrenci**
- Projeyi tek tek dosya, klasör veya ZIP olarak teslim; her yükleme yeni bir sürüm
- Hocanın izin verdiği ödevlerde **teslim öncesi ön kontrol**
- Çözüm yazmayan, ipucuyla yönlendiren **AI mentor**
- Ödevden ödeve gelişim grafiği ve rozetler; sınıf topluluğunda soru-cevap

**Güvenlik ve kişisel veriler**
- Şifreler bcrypt ile; iki adımlı doğrulama (TOTP), hatalı girişte hesap kilidi
- Yeni cihazdan giriş bildirimi, aktif oturumları görme ve uzaktan kapatma
- Web oturumu JavaScript'in okuyamadığı httpOnly çerezde; kısa ömürlü erişim token'ı
- Rol bazlı erişim; dışarıdan kayıt yok (hesapları yönetici açar); güvenlik kayıtları
- Yapay zekâya öğrencinin adı/numarası gönderilmez, yalnızca kod ve ödev gereksinimleri
- KVKK aydınlatma metni ve veri envanteri ([docs/KVKK.md](docs/KVKK.md))

## Teknolojiler

| Katman | Teknoloji |
|---|---|
| Sunucu | Python 3.12, FastAPI, SQLAlchemy 2, Alembic |
| Web | React, Vite, TypeScript |
| Mobil | React Native, Expo (web ile aynı özellik seti) |
| Veritabanı | PostgreSQL |
| Yapay zekâ | Anthropic Claude API (tek servis katmanı arkasında, model yapılandırmadan seçilir) |
| Kalite | 100+ otomatik test, her gönderimde GitHub Actions ile test ve derleme |

## Mimari

```
 Web (React)  ─┐
               ├──►  API (FastAPI)  ──►  PostgreSQL
 Mobil (Expo) ─┘          │
                          └──►  Yapay zekâ servis katmanı  ──►  Claude API
                                (yalnızca akademisyen isteğiyle)
```

- `backend/` — API, veri modeli, yapay zekâ servis katmanı, güvenlik, testler
- `frontend/` — web arayüzü
- `mobile/` — Android / iOS uygulaması

## Lisans

Tüm hakları saklıdır. Bu depo yalnızca incelenmek için herkese açıktır; kod izinsiz
kopyalanamaz, kullanılamaz veya çalıştırılamaz. Ayrıntı: [LICENSE](LICENSE).
