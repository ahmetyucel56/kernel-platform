"""Merkezi konfigurasyon.

Tum saglayici (provider) secimleri ve marka adi burada, env'den okunur.
Kod icinde hicbir yerde model adi / marka adi / provider hardcode edilmez
(spec Bolum 3 ve 8.5 mimari kurali).
"""
from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # Marka
    brand_name: str = "Kernel"

    # Veritabani
    database_url: str = "sqlite:///./kernel.db"
    # Acilista Alembic gecislerini uygula (`upgrade head`). Birden fazla sunucu
    # ornegine gecilirse false yapip gecisi deploy adiminda calistir.
    auto_create_tables: bool = True
    # Baslangicta ornek veri/hesaplari olustur (yalnizca demo deploy icin).
    seed_on_start: bool = False
    # Seed calisirken hocaya tanitim icin dolu bir "Tanitim Sinifi" de olustur.
    seed_demo_class: bool = True
    # Giris ekraninda "Hoca olarak dene / Ogrenci olarak dene" tek tik demo girisi.
    # Bos birakilirsa SEED_ON_START'i izler (demo hesaplar varsa acik).
    demo_login: bool | None = None
    # Not: disaridan kendi kendine kayit YOKTUR (kasitli). Hesaplari kurucu/yonetici
    # acar; okul OBS sistemine baglaninca ogrenciler okul no + OBS sifresiyle girecek.

    # AI mentor: ogrenci basina 24 saatte en fazla bu kadar soru (maliyet + kotuye kullanim)
    mentor_daily_limit: int = 20

    @property
    def demo_login_enabled(self) -> bool:
        return self.seed_on_start if self.demo_login is None else self.demo_login

    # Auth
    auth_provider: Literal["local", "supabase"] = "local"
    jwt_secret: str = "dev-secret-change-me"
    jwt_expires_minutes: int = 10080  # 7 gun
    admin_jwt_expires_minutes: int = 480  # yonetici oturumu 8 saat
    # KVKK aydinlatma metninde gosterilir (okul/kurum belli olunca Render'da degistir)
    privacy_controller: str = "Kernel projesi (pilot uygulama)"
    privacy_contact: str = ""
    security_log_days: int = 365  # guvenlik kayitlari bu sureden sonra silinir
    # Kurucu hesabini bir kez olusturmak icin gizli anahtar (Render'da ayarlanir,
    # en az 24 karakter). Kurucu olusunca kurulum kapanir; sonra silinebilir.
    founder_setup_token: str = ""

    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_key: str = ""
    supabase_jwt_secret: str = ""

    # Storage
    storage_provider: Literal["local", "supabase"] = "local"
    storage_dir: str = "./storage"
    storage_bucket: str = "submissions"  # supabase: OZEL bucket (ilk yazmada olusturulur)

    # Yukleme limitleri (zip-bomb / kotu niyetli dosyalara karsi koruma)
    max_zip_bytes: int = 20 * 1024 * 1024  # sikistirilmis ZIP azami boyutu (20 MB)
    max_uncompressed_bytes: int = 100 * 1024 * 1024  # acilmis toplam azami (100 MB)
    max_files: int = 2000  # azami dosya sayisi
    max_text_file_bytes: int = 1 * 1024 * 1024  # tek metin dosyasi azami (DB'ye yazilir)

    # AI (tek servis katmani arkasinda)
    ai_provider: Literal["anthropic", "mock"] = "mock"
    ai_model: str = "claude-haiku-4-5"
    anthropic_api_key: str = ""

    # CORS
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
