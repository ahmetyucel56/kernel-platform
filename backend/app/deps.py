"""Ortak FastAPI bagimliliklari: mevcut kullanici cozumleme ve rol kontrolu.

Auth bir soyutlama arkasindadir: AUTH_PROVIDER=local su an platformun kendi
JWT'sini dogrular; ileride 'supabase' saglayicisi Supabase Auth JWT'lerini
dogrulayacak sekilde bu tek noktada eklenebilir.
"""
import uuid

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models import User, UserSession
from app.services import sessions
from app.security import decode_token

_bearer = HTTPBearer(auto_error=True)


# Gecici sifreyle girmis kullanici once sifresini degistirmeli: yalnizca bunlar acik.
_MUST_CHANGE_ALLOWED = {"/auth/me", "/auth/change-password", "/auth/logout-all", "/auth/security",
                        "/auth/logout", "/auth/sessions"}


def get_current_user(
    request: Request,
    creds: HTTPAuthorizationCredentials = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    token = creds.credentials

    if settings.auth_provider == "local":
        try:
            payload = decode_token(token)
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Gecersiz veya suresi dolmus oturum.",
            )
        if payload.get("purpose"):  # ozel amacli token (orn. indirme) oturum acamaz
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Gecersiz veya suresi dolmus oturum.",
            )
        user_id = payload.get("sub")
    else:  # pragma: no cover - Supabase saglayicisi ileride implemente edilecek
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="Supabase auth saglayicisi henuz aktif degil.",
        )

    try:
        user = db.get(User, uuid.UUID(str(user_id)))
    except (ValueError, TypeError):
        user = None
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Kullanici bulunamadi."
        )
    # Devre disi hesap ya da iptal edilmis oturum (sifre degisti / tum cihazlardan cikildi)
    if not user.is_active or payload.get("tv", 0) != (user.token_version or 0):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Oturumun sona erdi. Lütfen tekrar giriş yap.",
        )
    # Cihaz oturumu kapatildiysa (tek tek, tum cihazlardan cikis, sifre degisimi) token gecersiz.
    # (sid'siz eski token'lar yalnizca token_version ile denetlenir; en gec 7 gunde biter.)
    sid = payload.get("sid")
    if sid:
        try:
            s = db.get(UserSession, uuid.UUID(str(sid)))
        except (ValueError, TypeError):
            s = None
        if not sessions.is_valid(s, user.id):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Oturumun sona erdi. Lütfen tekrar giriş yap.",
            )
        sessions.touch(db, s)
    request.state.sid = sid
    if user.must_change_password and request.url.path not in _MUST_CHANGE_ALLOWED:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Devam etmeden önce şifreni değiştirmelisin.",
        )
    return user


def require_roles(*roles: str):
    def _guard(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Bu islem icin yetkiniz yok.",
            )
        return user

    return _guard
