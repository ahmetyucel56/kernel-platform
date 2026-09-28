"""Parola hash'leme ve JWT yardimcilari (yerel auth saglayicisi icin)."""
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from app.config import settings


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def create_access_token(subject: str, role: str, tv: int = 0, sid: str | None = None,
                        minutes: int | None = None) -> str:
    """Oturum token'i. 'tv' kullanicinin token_version'i: sifre degisince / "tum
    cihazlardan cik" denince artar ve eski token'lar gecersiz olur. Yonetici
    oturumlari daha kisa omurludur."""
    now = datetime.now(timezone.utc)
    if minutes is None:
        minutes = settings.admin_jwt_expires_minutes if role == "admin" else settings.jwt_expires_minutes
    payload = {
        "sub": subject,
        "role": role,
        "tv": tv,
        "iat": now,
        "exp": now + timedelta(minutes=minutes),
    }
    if sid:
        payload["sid"] = sid  # cihaz oturumu: tek basina kapatilabilir
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def create_purpose_token(claims: dict, purpose: str, minutes: int) -> str:
    """Kisa omurlu, tek amacli token (2FA adimi, kurucu kurulumu). Oturum yerine gecmez."""
    now = datetime.now(timezone.utc)
    payload = {**claims, "purpose": purpose, "iat": now, "exp": now + timedelta(minutes=minutes)}
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_purpose_token(token: str, purpose: str) -> dict | None:
    try:
        payload = decode_token(token)
    except Exception:
        return None
    return payload if payload.get("purpose") == purpose else None


def decode_token(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])


DOWNLOAD_TTL_MINUTES = 5


def create_download_token(resource_id: str, user_id: str, purpose: str = "download") -> str:
    """Tek bir kaynagi (teslim ZIP'i, sinif not dosyasi...) indirmeye yarayan kisa omurlu token.

    'purpose' alani sayesinde oturum token'i yerine KULLANILAMAZ (deps reddeder) ve
    bir amacin linki digerinde gecmez; link paylasilsa bile 5 dakikada ve yalnizca
    o kaynak icin gecerlidir.
    """
    now = datetime.now(timezone.utc)
    payload = {
        "sub": resource_id,
        "uid": user_id,
        "purpose": purpose,
        "iat": now,
        "exp": now + timedelta(minutes=DOWNLOAD_TTL_MINUTES),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")
