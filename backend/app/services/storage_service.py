"""Dosya depolama soyutlamasi (ai_service / auth ile ayni desen).

Ham ZIP burada saklanir. Provider config'ten (STORAGE_PROVIDER) secilir:
- local    -> STORAGE_DIR altinda diske yazar (gelistirme). Not: Render ucretsiz
              disk gecicidir; bu yuzden dosya AGACI ve ICERIGI ayrica Postgres'te
              tutulur (submission_files).
- supabase -> Supabase Storage (kalici, ozel bucket). SUPABASE_URL +
              SUPABASE_SERVICE_KEY gerekir; bucket yoksa ilk yazmada olusturulur.
"""
from __future__ import annotations

import os
from abc import ABC, abstractmethod
from urllib.parse import quote

import httpx

from app.config import settings


class StorageProvider(ABC):
    @abstractmethod
    def save(self, key: str, data: bytes) -> str:
        """Veriyi saklar ve daha sonra erisim icin bir yol/anahtar dondurur."""
        ...

    @abstractmethod
    def load(self, key: str) -> bytes | None:
        """Veriyi dondurur; yoksa None."""
        ...

    @abstractmethod
    def delete(self, keys: list[str]) -> None:
        """Anahtarlari siler (olmayanlar sessizce gecilir)."""
        ...


class LocalStorageProvider(StorageProvider):
    def __init__(self) -> None:
        self.base = os.path.abspath(settings.storage_dir)
        os.makedirs(self.base, exist_ok=True)

    def _full(self, key: str) -> str:
        # key'i base altina hapset (path traversal'a karsi).
        safe = os.path.normpath(key).lstrip("/\\")
        full = os.path.join(self.base, safe)
        if not os.path.abspath(full).startswith(self.base):
            raise ValueError("Gecersiz depolama anahtari.")
        return full

    def save(self, key: str, data: bytes) -> str:
        full = self._full(key)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "wb") as fh:
            fh.write(data)
        return key

    def load(self, key: str) -> bytes | None:
        full = self._full(key)
        if not os.path.exists(full):
            return None
        with open(full, "rb") as fh:
            return fh.read()

    def delete(self, keys: list[str]) -> None:
        for key in keys:
            full = self._full(key)
            if os.path.exists(full):
                os.remove(full)


class SupabaseStorageProvider(StorageProvider):
    """Supabase Storage REST API'si (service key ile; bucket OZEL kalir)."""

    def __init__(self, client: httpx.Client | None = None) -> None:
        if not settings.supabase_url or not settings.supabase_service_key:
            raise RuntimeError(
                "STORAGE_PROVIDER=supabase icin SUPABASE_URL ve SUPABASE_SERVICE_KEY gerekli."
            )
        self.base = settings.supabase_url.rstrip("/") + "/storage/v1"
        self.bucket = settings.storage_bucket
        key = settings.supabase_service_key
        self.http = client or httpx.Client(timeout=30)
        self.headers = {"Authorization": f"Bearer {key}", "apikey": key}

    def _obj(self, key: str) -> str:
        return f"{self.base}/object/{self.bucket}/{quote(key.lstrip('/'))}"

    def _ensure_bucket(self) -> None:
        r = self.http.post(f"{self.base}/bucket", headers=self.headers,
                           json={"id": self.bucket, "name": self.bucket, "public": False})
        if r.status_code >= 400 and "already exists" not in r.text.lower():
            r.raise_for_status()

    def save(self, key: str, data: bytes) -> str:
        headers = {**self.headers, "Content-Type": "application/zip", "x-upsert": "true"}
        r = self.http.post(self._obj(key), headers=headers, content=data)
        if r.status_code in (400, 404) and "bucket" in r.text.lower():
            self._ensure_bucket()  # ilk kullanim: ozel bucket'i olustur, tekrar dene
            r = self.http.post(self._obj(key), headers=headers, content=data)
        r.raise_for_status()
        return key

    def load(self, key: str) -> bytes | None:
        r = self.http.get(self._obj(key), headers=self.headers)
        if r.status_code in (400, 404):
            return None
        r.raise_for_status()
        return r.content

    def delete(self, keys: list[str]) -> None:
        if not keys:
            return
        r = self.http.request("DELETE", f"{self.base}/object/{self.bucket}",
                              headers=self.headers, json={"prefixes": keys})
        if r.status_code not in (400, 404):
            r.raise_for_status()


_PROVIDERS = {
    "local": LocalStorageProvider,
    "supabase": SupabaseStorageProvider,
}


def get_storage_provider() -> StorageProvider:
    provider_cls = _PROVIDERS.get(settings.storage_provider)
    if provider_cls is None:
        raise RuntimeError(f"Bilinmeyen STORAGE_PROVIDER: {settings.storage_provider!r}")
    return provider_cls()
