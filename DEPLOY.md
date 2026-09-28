# Kernel — Ücretsiz Demo Yayını (Vercel + Render + Supabase)

Bu rehber, demoyu tamamen ücretsiz public bir adrese çıkarır:

- **Frontend** → Vercel (`https://<proje>.vercel.app`)
- **Backend** → Render (`https://<proje>.onrender.com`)
- **Veritabanı** → Supabase (Postgres, ücretsiz)

> Hesap açma ve şifre girme adımlarını **sen** yaparsın (ben yapamam). Config
> dosyaları hazır; aşağıdaki sırayı takip et. Yaklaşık 20-30 dk sürer.

---

## 0) Kodu GitHub'a gönder

Render ve Vercel, dağıtımı bir Git deposundan yapar. Repo zaten `git init` ile hazır.

1. github.com'da **boş** bir repo oluştur (README ekleme): örn. `kernel`.
2. Proje klasöründe (`kernel/`) şunları çalıştır:

```bash
git add -A
git commit -m "Kernel MVP — Sprint 0 + deploy config"
git branch -M main
git remote add origin https://github.com/<KULLANICI_ADIN>/kernel.git
git push -u origin main
```

---

## 1) Supabase (veritabanı)

1. https://supabase.com → **Start your project** → GitHub ile giriş (ücretsiz, kart yok).
2. **New project** → isim ver, güçlü bir **Database Password** belirle (bir yere kaydet), bölge olarak sana yakın olanı seç (örn. `Central EU (Frankfurt)`).
3. Proje açılınca: **Project Settings → Database → Connection string** → sekmelerden **Session pooler**'ı seç. Şuna benzer:
   ```
   postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres
   ```
4. Bunu Render'da kullanmak için **iki değişiklik** yap:
   - `[YOUR-PASSWORD]` yerine gerçek parolanı yaz.
   - Baştaki `postgresql://` → **`postgresql+psycopg://`** yap.

   Sonuç (Render'a gireceğin `DATABASE_URL`):
   ```
   postgresql+psycopg://postgres.abcdefgh:GERCEK_PAROLA@aws-0-eu-central-1.pooler.supabase.com:5432/postgres
   ```

> ⚠️ **Direct connection**'ı (`db.<ref>.supabase.co`) KULLANMA — o IPv6'dır ve
> Render onu göremez. Mutlaka **Session pooler** (`...pooler.supabase.com:5432`).

---

## 2) Render (backend)

1. https://render.com → GitHub ile giriş (ücretsiz).
2. **New + → Blueprint** → GitHub repo'nu (`kernel`) seç. Render, repo kökündeki
   `render.yaml`'i okuyup **kernel-backend** servisini önerir. **Apply**.
3. İlk kurulumda seni iki değişkeni girmeye yönlendirir (render.yaml'de `sync:false`):
   - **DATABASE_URL** → 1. adımdaki `postgresql+psycopg://...pooler...:5432/postgres` dizesi.
   - **CORS_ORIGINS** → şimdilik boş bırak veya `http://localhost:5173` yaz (Vercel adresini 4. adımda ekleyeceğiz).
4. Deploy bitince backend adresin: `https://kernel-backend-XXXX.onrender.com`.
   Kontrol: tarayıcıda `.../health` → `{"status":"ok",...}` görmelisin.
   - `SEED_ON_START=true` olduğu için demo hesapları otomatik oluşur:
     `hoca@kernel.dev` / `ogrenci1@kernel.dev` / `admin@kernel.dev` — parola: `parola123`.

> Not: Render ücretsiz servis 15 dk hareketsizlikte uyur; ilk istek ~30-50 sn
> gecikebilir (sonrası hızlı). Demo için normaldir.

---

## 3) Vercel (frontend)

1. https://vercel.com → GitHub ile giriş (ücretsiz).
2. **Add New → Project** → `kernel` repo'sunu **Import**.
3. **Root Directory** → `frontend` seç (önemli). Framework otomatik **Vite** algılanır.
4. **Environment Variables** ekle:
   - `VITE_API_BASE_URL` = Render backend adresin, örn. `https://kernel-backend-XXXX.onrender.com`
   - `VITE_BRAND_NAME` = `Kernel`
5. **Deploy**. Bitince frontend adresin: `https://kernel-XXXX.vercel.app`.

---

## 4) İki ucu bağla (CORS)

Backend, frontend adresinden gelen isteklere izin vermeli:

1. Render → **kernel-backend → Environment** → `CORS_ORIGINS` değerini Vercel
   adresinle güncelle (sonunda `/` olmadan):
   ```
   CORS_ORIGINS=https://kernel-XXXX.vercel.app
   ```
   (Birden fazla adres virgülle: `https://a.vercel.app,https://b.vercel.app`)
2. Render otomatik yeniden dağıtır (veya **Manual Deploy → Deploy latest commit**).

---

## 5) Test

1. `https://kernel-XXXX.vercel.app` adresine gir.
2. `hoca@kernel.dev` / `parola123` ile giriş yap → akademisyen paneli açılmalı,
   seed'lenmiş `WEB202 - 2025 Guz` sınıfı ve ödevi görünmeli.

Demo hazır. 🎉

---

## Güncelleme akışı (bundan sonra)

`main`'e her `git push` → Render backend'i ve Vercel frontend'i **otomatik**
yeniden dağıtır. Ayrı bir işlem gerekmez.

## Demo sonrası güvenlik notları

- `SEED_ON_START` ve varsayılan demo parolaları yalnızca demo içindir. Gerçek
  kullanıma geçince: `SEED_ON_START=false` yap ve demo hesaplarını sil/değiştir.
- `JWT_SECRET` Render tarafından otomatik üretildi (render.yaml `generateValue`).
- Supabase parolanı ve connection string'ini kimseyle paylaşma; bunlar yalnızca
  Render Environment'ta durur, repoda değil.
