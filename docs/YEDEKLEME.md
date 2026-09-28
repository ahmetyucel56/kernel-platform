# Veritabanı yedeği ve geri yükleme

Canlı veritabanı (Supabase Postgres) GitHub Actions ile **haftada iki kez** (Pazartesi ve
Perşembe 04:00) yedeklenir. İstersen GitHub → Actions → "Veritabanı yedeği" → **Run workflow**
ile elle de alabilirsin.

- Yedek, uygulamanın bütün tablolarını içerir: kullanıcılar, sınıflar, ödevler, teslimler,
  **teslim dosyalarının içerikleri**, notlar, AI analizleri, topluluk, güvenlik kayıtları.
  (Ham ZIP'ler Supabase Storage'dadır; kaybolsalar da "Projeyi indir" dosyaları veritabanından
  yeniden paketler.)
- Yedek **AES-256 ile şifrelenir**; parolan olmadan açılamaz. GitHub'da 90 gün saklanır.
- Her yedekte döküm açılıp temel tabloların içinde olduğu kontrol edilir. Kontrol başarısız
  olursa iş kırmızı biter ve GitHub sana e-posta gönderir.

## Bir kerelik kurulum

GitHub → depo → **Settings → Secrets and variables → Actions → New repository secret**:

| Ad | Değer |
| --- | --- |
| `BACKUP_DATABASE_URL` | Render'daki `DATABASE_URL` ile aynı değer (Supabase *session pooler*, port 5432) |
| `BACKUP_PASSPHRASE` | En az 20 karakterlik, yalnızca yedek için kullanılan bir parola |

> Bu değerleri kimseyle (sohbet dahil) paylaşma. **Parolayı şifre yöneticinde sakla:**
> kaybolursa yedekler açılamaz.

Kurduktan sonra Actions → "Veritabanı yedeği" → **Run workflow** ile bir kez elle çalıştırıp
yeşil bittiğini kontrol et.

## Geri yükleme (gerekirse)

1. GitHub → Actions → "Veritabanı yedeği" → istediğin çalıştırma → **Artifacts** →
   `kernel-yedek-...` dosyasını indir ve zip'ten çıkar.
2. Şifreyi çöz:

   ```bash
   gpg --output kernel.dump --decrypt kernel-TARIH.dump.gpg
   ```

3. Hedef veritabanına yükle. Önce **yeni/boş** bir veritabanına (ör. yeni bir Supabase projesi
   ya da yerel Postgres) yükleyip kontrol etmek en güvenlisidir:

   ```bash
   pg_restore --no-owner --no-privileges --dbname "postgresql://KULLANICI:PAROLA@SUNUCU:5432/postgres" kernel.dump
   ```

4. Render'daki `DATABASE_URL`'i yeni veritabanına çevir. Uygulama açılışta şema sürümünü
   (Alembic) kendisi kontrol eder; `/health` → `schema` alanında sürümü görebilirsin.

`pg_restore` ve `gpg` bilgisayarında yoksa: PostgreSQL 17 istemci araçları ve Gpg4win
(Windows) ya da Git Bash içindeki `gpg` yeterli.
