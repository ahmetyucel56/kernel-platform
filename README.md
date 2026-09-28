# Kernel — AI Destekli Ödev, Code Review ve Mentorluk Platformu

> Marka adı **"Kernel"** şu an placeholder'dır ve tek yerden değiştirilebilir
> (backend `.env` → `BRAND_NAME`, frontend `.env` → `VITE_BRAND_NAME`).

Öğrencilerin ödevlerini simüle bir Pull Request gibi sunduğu, akademisyenin
sınıf bazlı yönetim + serbest code review yaptığı, yapay zekanın **yalnızca
akademisyen tetiklediğinde** analiz ürettiği bulut tabanlı eğitim platformu.
(Tek istisna: akademisyen ödevde açarsa öğrencinin teslim öncesi ön kontrolü.)

## Teknoloji

| Katman | Seçim |
|---|---|
| Backend | Python 3.12 + FastAPI + SQLAlchemy 2 + Alembic |
| Web | React + Vite + TypeScript |
| Mobil | Expo (React Native) + expo-router — web ile aynı özellikler |
| Veritabanı | Yerel: SQLite · Canlı: Supabase (Postgres) — `DATABASE_URL` ile |
| AI | Anthropic Claude API (tek servis katmanı arkasında, model config'ten) |

Mimari kural: **provider/model adı hiçbir yerde hardcode değildir** — hepsi
`.env`'den okunur (bkz. `backend/app/config.py`, `backend/app/services/ai_service.py`).
API anahtarı yoksa `AI_PROVIDER=mock` sezgisel analizlerle çalışır.

## Hızlı başlangıç (yerel, kurulum gerektirmez)

### 1) Backend

```bash
cd backend
py -m venv .venv
./.venv/Scripts/python.exe -m pip install -r requirements-dev.txt
cp .env.example .env
./.venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8000
```

> ⚠️ Yerelde `DATABASE_URL`'in **yerel SQLite**'ı gösterdiğinden emin ol
> (ör. `sqlite:///./local_demo.db`). Canlı veritabanına yerelden test yazma.

Açılışta şema Alembic ile kurulur; `SEED_ON_START=true` ise demo veriler oluşur.
Demo girişler (okul no + parola `parola123`, üniversite alanı serbest):
öğrenci `2025001` / `2025002` · akademisyen `9001` · admin `1000`.

API dokümanı: http://localhost:8000/docs

### 2) Web

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Uygulama: http://localhost:5173

### 3) Mobil

```bash
cd mobile
npm install
npx expo start
```

Varsayılan olarak canlı backend'e bağlanır; `EXPO_PUBLIC_API_URL` ile değiştirilebilir.

## Testler

```bash
cd backend
./.venv/Scripts/python.exe -m pytest
```

Testler geçici bir SQLite + mock AI ile çalışır; gerçek `.env`'deki veritabanına
ve anahtarlara dokunmaz. Kapsam: sınıf AI özeti, gereksinim motoru (gerçek AI yolu
sahte sağlayıcıyla), ön kontrol, gelişim takibi, yetkiler, topluluk, geçişler.
Web/mobil için: `npx tsc --noEmit` (mobilde paket kontrolü: `npx expo export --platform android`).

## Veritabanı geçişleri (Alembic)

Şema değişiklikleri `backend/migrations/` altındaki Alembic geçişleriyle yapılır;
uygulama açılışta `alembic upgrade head` çalıştırır (`AUTO_CREATE_TABLES=true`).

Model değiştirdikten sonra (her zaman **yerel** bir veritabanıyla):

```bash
cd backend
DATABASE_URL=sqlite:///./migrate_tmp.db ./.venv/Scripts/alembic upgrade head
DATABASE_URL=sqlite:///./migrate_tmp.db ./.venv/Scripts/alembic revision --autogenerate -m "aciklama"
```

Üretilen dosyayı gözden geçir (SQLite'a özgü varsayılanlar Postgres'te çalışmayabilir;
ör. boolean için `sa.false()` kullan). `test_models_and_migrations_are_in_sync`
testi, model değişip geçiş unutulursa kırılır. `/health` → `schema` canlıdaki
sürümü gösterir.

## Canlı ortam

- **Web:** Vercel (kök `frontend`) · **Backend:** Render (`render.yaml`) ·
  **DB:** Supabase Postgres. `main`'e her push iki tarafı da yeniden dağıtır.
- Supabase bağlantısında **Session pooler** adresini kullan
  (`postgresql+psycopg://...pooler.supabase.com:5432/postgres`); doğrudan bağlantı
  IPv6'dır ve Render erişemez.
- Canlıda gerçek Claude için Render panelinde `AI_PROVIDER=anthropic` +
  `ANTHROPIC_API_KEY` (anahtar asla repoya girmez).

## Durum

**✅ Faz 1 (MVP)** — Sprint 0–5: altyapı + rol bazlı auth, bölüm/ders/sınıf, ödev +
teslim tarihi; güvenli ZIP yükleme, dosya ağacı, sürümleme, diff; akademisyen
yorum + not; AI analiz motoru (Clean Code, gereksinim kontrolü, intihal, README
taslağı); gamification + sınıf geneli rapor; topluluk veri modeli.

**✅ Faz 2** — Topluluk arayüzü (Reddit tarzı: oy, Yeni/Popüler, düzenleme, moderasyon),
öğrenci–AI mentor sohbeti, satır bazlı yorum, mobil uygulama (web ile tam eşlik).

**Faz 2 sonrası eklenenler** — Sınıf AI özeti pop-it'i (kural bazında tam/kısmen/eksik,
riskli öğrenciler, toplu analiz), eksikleri öğrenciye tek tıkla gönderme, kurallar
değişince eski analiz tespiti, notlamada AI referansı, büyük projelerde ilgili kodu
önceliklendiren bağlam seçimi, öğrencinin teslim öncesi ön kontrolü (hoca izniyle),
ödevler arası gelişim ve tekrar eden zayıflık takibi, bildirimler.

**Faz 3 — canlıya hazırlık (sürüyor)**
- [x] Alembic geçişleri (canlı DB veri kaybı olmadan geçirildi)
- [x] Dosya saklama: Supabase Storage (özel bucket) + "Projeyi indir" (5 dk geçerli,
  teslime özel imzalı link; orijinal yoksa DB'den yeniden paketleme). Canlıda açmak için
  Render'da `STORAGE_PROVIDER=supabase`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`.
- [ ] Okul sistemi (OBS/Proliz) girişi — okulun onayı ve erişimi bekleniyor
- [ ] Gerçek kullanım öncesi: demo hesapları ve `SEED_ON_START`'ı kapatmak

## Proje yapısı

```
backend/
  app/
    config.py            # tüm provider/model/marka ayarları (env)
    db.py, models.py     # SQLAlchemy modelleri + açılışta Alembic geçişi
    security.py, deps.py # parola/JWT + rol kontrolü (auth soyutlaması)
    services/            # ai_service (tek AI katmanı), analysis_service, storage, bildirim
    routers/             # auth, org, assignments, submissions, insights (sınıf AI özeti),
                         # precheck, community, notifications, me
    lib/ziputil.py       # güvenli ZIP açma
  migrations/            # Alembic geçişleri
  tests/                 # pytest
frontend/src/
  styles/theme.css       # renk token'ları + tipografi
  api/, auth/, theme/    # istemci + context'ler
  components/, pages/    # review (AI paneli, pop-it), student, community, academician
mobile/
  app/                   # expo-router ekranları
  src/                   # api istemcisi, ortak bileşenler (ClassAiSheet, PrecheckCard...)
```
