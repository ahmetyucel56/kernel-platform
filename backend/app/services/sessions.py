"""Cihaz oturumlari.

Web: uzun omurlu oturum anahtari JavaScript'in OKUYAMADIGI bir httpOnly cerezde
durur (kernel_rt). Cerez yalnizca /api/auth yoluna ve ayni siteye gider; web
uygulamasi giris/yenileme isteklerini Vercel uzerinden (/api -> backend) yapar,
boylece cerez birinci taraf olur. Asil API cagrilari 15 dakikalik, yalnizca
bellekte tutulan erisim token'iyla dogrudan backend'e gider. XSS olsa bile
kalici oturum calinamaz; calinan kisa token 15 dakikada olur.

Mobil: token cihazin guvenli deposunda (Keychain/Keystore); oturum yine bu
tabloda kayitli oldugu icin tek tek kapatilabilir.

Her iki istemcide de yeni bir cihaz ilk kez giris yaptiginda kullaniciya
bildirim gider.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, Request, Response
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.config import settings
from app.models import User, UserSession
from app.security import create_access_token
from app.services import account_security as sec

REFRESH_COOKIE = "kernel_rt"
DEVICE_COOKIE = "kernel_did"
COOKIE_PATH = "/api/auth"  # tarayicidaki yol (Vercel /api/* -> backend)
WEB_ACCESS_MINUTES = 15
WEB_REMEMBER_DAYS = 30
WEB_SESSION_HOURS = 24  # "beni hatirla" kapaliyken
ADMIN_SESSION_HOURS = 12


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _h(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def is_web(request: Request) -> bool:
    return request.headers.get("x-kernel-client") == "web"


def device_label(ua: str | None) -> str:
    """Kullaniciya gosterilecek kaba cihaz adi ("Chrome · Windows")."""
    ua = ua or ""
    if not ua:
        return "Bilinmeyen cihaz"
    browser = next((name for key, name in (("Edg/", "Edge"), ("OPR/", "Opera"), ("Chrome/", "Chrome"),
                                           ("Firefox/", "Firefox"), ("Safari/", "Safari")) if key in ua),
                   "Kernel uygulaması" if any(k in ua for k in ("okhttp", "Expo", "CFNetwork", "Dalvik"))
                   else "Tarayıcı")
    os_ = next((name for key, name in (("Android", "Android"), ("iPhone", "iOS"), ("iPad", "iOS"),
                                       ("Windows", "Windows"), ("Mac OS", "macOS"), ("Linux", "Linux")) if key in ua), "")
    return f"{browser} · {os_}" if os_ else browser


def _device_key(request: Request, response: Response | None) -> str:
    """Web: kalici httpOnly cihaz cerezi (yoksa uretilir). Mobil: uygulamanin
    guvenli depoda tuttugu X-Device-Id. Hicbiri yoksa tarayici imzasi."""
    if is_web(request):
        key = request.cookies.get(DEVICE_COOKIE)
        if not key or len(key) < 20:
            key = secrets.token_urlsafe(24)
            if response is not None:
                response.set_cookie(DEVICE_COOKIE, key, max_age=2 * 365 * 24 * 3600, path=COOKIE_PATH,
                                    httponly=True, secure=True, samesite="strict")
        return "web:" + key
    did = (request.headers.get("x-device-id") or "").strip()
    if 16 <= len(did) <= 100:
        return "mobile:" + did
    return "ua:" + (request.headers.get("user-agent") or "")


def _expiry(user: User, web: bool, remember: bool) -> datetime:
    if user.role == "admin":
        hours = ADMIN_SESSION_HOURS
    elif web:
        hours = WEB_REMEMBER_DAYS * 24 if remember else WEB_SESSION_HOURS
    else:
        hours = settings.jwt_expires_minutes / 60
    return _now() + timedelta(hours=hours)


def access_token_for(user: User, s: UserSession) -> str:
    minutes = WEB_ACCESS_MINUTES if s.client == "web" else None
    return create_access_token(str(user.id), user.role, user.token_version or 0, sid=str(s.id), minutes=minutes)


def start(db: Session, user: User, request: Request, response: Response, remember: bool = True) -> str:
    """Yeni oturum acar, (web'de) cerezleri yazar, yeni cihazsa bildirir; erisim token'i dondurur."""
    web = is_web(request)
    # Eski kayitlari temizle: demo hesaplarda suresi dolanlar hemen (her tiklama yeni oturum),
    # digerlerinde 60 gun sonra (yeni cihaz tespiti icin gecmis bir sure tutulur).
    keep_days = 0 if user.is_demo else 60
    db.execute(delete(UserSession).where(
        UserSession.user_id == user.id, UserSession.expires_at < _now() - timedelta(days=keep_days)))
    device_hash = _h(_device_key(request, response))
    seen_before = db.scalar(select(UserSession.id).where(
        UserSession.user_id == user.id, UserSession.device_hash == device_hash).limit(1))
    has_any = db.scalar(select(UserSession.id).where(UserSession.user_id == user.id).limit(1))
    secret = secrets.token_urlsafe(32) if web else None
    s = UserSession(
        user_id=user.id, client="web" if web else "mobile", secret_hash=_h(secret) if secret else None,
        device_hash=device_hash, user_agent=(request.headers.get("user-agent") or "")[:300],
        ip=sec.client_ip(request), expires_at=_expiry(user, web, remember),
    )
    db.add(s)
    db.flush()
    if has_any and not seen_before and not user.is_demo:
        where = device_label(s.user_agent) + (f" ({s.ip})" if s.ip else "")
        sec.log_event(db, "new_device", user=user, request=request, detail=where)
        sec.notify_security(db, user, f"Hesabına yeni bir cihazdan giriş yapıldı: {where}. Sen değilsen hemen "
                                      "şifreni değiştir ve Profil → Güvenlik'ten bu oturumu kapat.")
    if web:
        response.set_cookie(REFRESH_COOKIE, f"{s.id}.{secret}",
                            max_age=int((s.expires_at - _now()).total_seconds()) if remember or user.role == "admin" else None,
                            path=COOKIE_PATH, httponly=True, secure=True, samesite="strict")
    db.commit()
    return access_token_for(user, s)


def is_valid(s: UserSession | None, user_id: uuid.UUID) -> bool:
    return bool(s and s.user_id == user_id and s.revoked_at is None and sec._aware(s.expires_at) > _now())


def touch(db: Session, s: UserSession) -> None:
    """Son gorulme zamanini seyrek guncelle (her istekte DB yazmasin)."""
    if _now() - (sec._aware(s.last_seen_at) or _now()) > timedelta(minutes=5):
        s.last_seen_at = _now()
        db.commit()


def from_cookie(db: Session, request: Request) -> UserSession | None:
    raw = request.cookies.get(REFRESH_COOKIE) or ""
    sid, _, secret = raw.partition(".")
    try:
        s = db.get(UserSession, uuid.UUID(sid))
    except (ValueError, TypeError):
        return None
    if s is None or not s.secret_hash or not hmac.compare_digest(s.secret_hash, _h(secret)):
        return None
    return s


def refresh(db: Session, request: Request) -> tuple[User, UserSession]:
    if not is_web(request):
        raise HTTPException(status_code=400, detail="Yalnızca web istemcisi.")
    s = from_cookie(db, request)
    user = db.get(User, s.user_id) if s else None
    if s is None or user is None or not user.is_active or not is_valid(s, user.id):
        raise HTTPException(status_code=401, detail="Oturum yok.")
    s.last_seen_at = _now()
    db.commit()
    return user, s


def clear_cookie(response: Response) -> None:
    response.delete_cookie(REFRESH_COOKIE, path=COOKIE_PATH, secure=True, httponly=True, samesite="strict")


def revoke(db: Session, s: UserSession) -> None:
    if s.revoked_at is None:
        s.revoked_at = _now()


def revoke_all(db: Session, user: User, keep: uuid.UUID | None = None) -> None:
    stmt = update(UserSession).where(UserSession.user_id == user.id, UserSession.revoked_at.is_(None))
    if keep:
        stmt = stmt.where(UserSession.id != keep)
    db.execute(stmt.values(revoked_at=_now()))


def active(db: Session, user: User) -> list[UserSession]:
    rows = db.scalars(select(UserSession).where(
        UserSession.user_id == user.id, UserSession.revoked_at.is_(None)
    ).order_by(UserSession.last_seen_at.desc())).all()
    return [s for s in rows if sec._aware(s.expires_at) > _now()]
