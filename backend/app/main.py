"""Kernel backend — FastAPI uygulama giris noktasi."""
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import db as db_module
from app.config import settings
from app.db import SessionLocal, init_db
from app.services import account_security as sec

if settings.sentry_dsn:
    import sentry_sdk

    def _scrub(event, _hint):
        # Ek guvence: istek govdesi, cerezler ve kimlik basliklari asla gitmesin
        req = event.get("request") or {}
        req.pop("data", None)
        req.pop("cookies", None)
        headers = req.get("headers") or {}
        for k in list(headers):
            if k.lower() in ("authorization", "cookie", "x-device-id"):
                headers[k] = "[silindi]"
        event.pop("user", None)
        return event

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment,
        send_default_pii=False,
        traces_sample_rate=0.0,  # yalnizca hatalar (performans izleme yok)
        max_request_body_size="never",
        before_send=_scrub,
    )
from app.services.analysis_service import AIUnavailable
from app.routers import (
    admin,
    assignments,
    auth,
    community,
    gradebook,
    insights,
    me,
    notifications,
    org,
    overview,
    precheck,
    submissions,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Semayi Alembic ile guncel surume getir (idempotent; Alembic oncesi DB'leri
    # bir kez stamp eder). Tek ornekli Render'da acilista calistirmak guvenli.
    if settings.auto_create_tables:
        init_db()
    # Guvenlik: zayif JWT anahtariyla oturum imzalama; parolasi repoda yazan eski
    # yonetici hesabini kapat. (Hata olursa uygulama ACILMAZ: guvensiz calismasin.)
    with SessionLocal() as db:
        sec.ensure_jwt_secret(db)
        sec.neutralize_seed_admin(db)
    # Demo deploy'da ornek hesaplari olustur (idempotent).
    if settings.seed_on_start:
        try:
            from app.seed import run as seed_run

            seed_run()
        except Exception as exc:  # seed hatasi uygulamayi dusurmesin
            print(f"[seed_on_start] atlandi: {exc}")
    with SessionLocal() as db:
        sec.ensure_demo_flags(db)
        sec.purge_old_security_events(db)  # KVKK: saklama suresi dolan kayitlar
    yield


app = FastAPI(title=f"{settings.brand_name} API", version="0.1.0", lifespan=lifespan)

@app.exception_handler(AIUnavailable)
async def _ai_unavailable(_request: Request, exc: AIUnavailable) -> JSONResponse:
    # Gercek AI cevap veremedi: sezgisel sonuc AI diye kaydedilmez, islem commit edilmez.
    print(f"[ai] istek AI olmadan sonuclanamadi: {exc}")
    return JSONResponse(
        status_code=503,
        content={"detail": "Yapay zekâ şu an yanıt veremedi; sonuç kaydedilmedi. "
                           "Biraz sonra tekrar dene."},
    )


@app.middleware("http")
async def _security_headers(request: Request, call_next):
    """Tarayici guvenlik basliklari: API baska sitede cercevelenemez, icerik turu
    tahmin edilmez, yanitlar (oturum/kisisel veri) onbellege yazilmaz."""
    response = await call_next(request)
    h = response.headers
    h.setdefault("X-Content-Type-Options", "nosniff")
    h.setdefault("X-Frame-Options", "DENY")
    h.setdefault("Referrer-Policy", "no-referrer")
    h.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    h.setdefault("Cross-Origin-Opener-Policy", "same-origin")
    h.setdefault("Cache-Control", "no-store")
    if request.headers.get("x-forwarded-proto") == "https" or request.url.scheme == "https":
        h.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(org.router)
app.include_router(assignments.router)
app.include_router(submissions.router)
app.include_router(insights.router)
app.include_router(precheck.router)
app.include_router(gradebook.router)
app.include_router(me.router)
app.include_router(overview.router)
app.include_router(notifications.router)
app.include_router(community.router)
app.include_router(community.posts_router)


@app.get("/meta/privacy", tags=["meta"])
def privacy_meta() -> dict:
    """KVKK aydinlatma metnindeki veri sorumlusu ve basvuru adresi (config'ten)."""
    return {"controller": settings.privacy_controller, "contact": settings.privacy_contact or None}


@app.get("/health", tags=["meta"])
def health() -> dict:
    # Baglanti dizesini SIZDIRMADAN yalnizca veritabani turunu bildir (teshis icin).
    url = settings.database_url
    db = "postgres" if "postgres" in url else "sqlite" if url.startswith("sqlite") else "other"
    return {
        "status": "ok",
        "brand": settings.brand_name,
        "auth_provider": settings.auth_provider,
        "ai_provider": settings.ai_provider,
        "storage_provider": settings.storage_provider,
        "db": db,
        "schema": db_module.schema_revision,  # acilista uygulanan Alembic surumu
    }
