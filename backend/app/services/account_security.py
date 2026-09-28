"""Hesap guvenligi: parola kurallari, giris kilidi, iki adimli dogrulama (TOTP),
yedek kodlar, guvenlik kayitlari ve acilista yapilan sertlestirmeler.

Amac: parola ele gecse bile hesabin ele gecmemesi (2FA), tahmin saldirilarinin
yavaslatilmasi (kilit + IP siniri), sizan bir oturumun geri alinabilmesi
(token_version) ve olan bitenin kayit altinda olmasi (SecurityEvent).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
import struct
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

from fastapi import HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import AppSetting, Notification, SecurityEvent, User
from app.security import hash_password, verify_password

# --- Parola kurallari -------------------------------------------------------
MIN_PASSWORD = 10
MIN_FOUNDER_PASSWORD = 14
_COMMON = {
    "parola123", "password", "password1", "password123", "123456789", "1234567890",
    "12345678910", "qwerty123", "qwertyuiop", "sifre1234", "sifre12345", "şifre1234",
    "1q2w3e4r5t", "abc1234567", "iloveyou12", "kernel1234", "kernel12345", "admin12345",
    "adminadmin", "letmein123", "welcome123", "galatasaray", "fenerbahce", "besiktas1903",
    "11111111111", "0000000000", "asdfghjkl1", "zxcvbnm123",
}


def check_password(password: str, *, hints: tuple[str | None, ...] = (), min_len: int = MIN_PASSWORD) -> None:
    """Yeni parolayi denetler; uygun degilse 400. (Mevcut parolalara dokunmaz.)"""
    p = password or ""
    low = p.lower()
    problem = None
    if len(p) < min_len:
        problem = f"Şifre en az {min_len} karakter olmalı."
    elif len(p.encode("utf-8")) > 72:
        problem = "Şifre çok uzun (en fazla 72 bayt)."
    elif low in _COMMON or len(set(p)) < 4:
        problem = "Bu şifre çok yaygın veya tahmin edilebilir; başka bir şifre seç."
    elif not any(c.isalpha() for c in p) or not any(not c.isalpha() for c in p):
        problem = "Şifre hem harf hem de rakam/işaret içermeli."
    else:
        words = {w for h in hints for w in re.split(r"[\s@._\-]+", (h or "").lower())}
        for h in words:
            if len(h) >= 4 and h not in {"demo", "kernel", "ogrenci", "personel"} and h in low:
                problem = "Şifre okul numaranı, adını veya e-postanı içermemeli."
                break
    if problem:
        raise HTTPException(status_code=400, detail=problem)


def temp_password() -> str:
    """Yoneticinin verdigi gecici sifre (okunakli; ilk giriste degistirilir)."""
    alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    body = "".join(secrets.choice(alphabet) for _ in range(12))
    return f"{body[:4]}-{body[4:8]}-{body[8:]}"


# --- Istemci bilgisi / kayit -------------------------------------------------
def client_ip(request: Request | None) -> str | None:
    if request is None:
        return None
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()[:64]
    return request.client.host if request.client else None


def log_event(db: Session, event: str, *, user: User | None = None, request: Request | None = None,
              actor: User | None = None, detail: str | None = None) -> None:
    db.add(SecurityEvent(
        user_id=user.id if user else None,
        actor_id=actor.id if actor else None,
        event=event,
        ip=client_ip(request),
        user_agent=(request.headers.get("user-agent") or "")[:300] if request else None,
        detail=(detail or "")[:300] or None,
    ))


def notify_security(db: Session, user: User, message: str) -> None:
    db.add(Notification(user_id=user.id, kind="security", message=message))


# --- Giris kilidi ------------------------------------------------------------
LOCK_AFTER = 5            # art arda hatali deneme
LOCK_MINUTES = 15         # ilk kilit; sonraki her 5 hatada 60 dk
IP_WINDOW_SECONDS = 15 * 60
IP_MAX_FAILURES = 30      # ayni IP'den 15 dk'da (farkli hesaplara dagitilmis tahmin)
_ip_failures: dict[str, deque] = defaultdict(deque)
# Kullanici yokken de bcrypt calissin: yanit suresinden hesabin varligi anlasilmasin
_DUMMY_HASH = hash_password(secrets.token_hex(8))


def _aware(dt: datetime | None) -> datetime | None:
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _ip_blocked(ip: str | None) -> bool:
    if not ip:
        return False
    q = _ip_failures[ip]
    cutoff = time.monotonic() - IP_WINDOW_SECONDS
    while q and q[0] < cutoff:
        q.popleft()
    return len(q) >= IP_MAX_FAILURES


def _ip_fail(ip: str | None) -> None:
    if ip:
        _ip_failures[ip].append(time.monotonic())


def ip_blocked(request: Request | None) -> bool:
    return _ip_blocked(client_ip(request))


def ip_fail(request: Request | None) -> None:
    _ip_fail(client_ip(request))


def reset_ip_limits() -> None:  # testler icin
    _ip_failures.clear()


def ensure_not_locked(user: User) -> None:
    until = _aware(user.locked_until)
    if until and until > datetime.now(timezone.utc):
        mins = max(1, int((until - datetime.now(timezone.utc)).total_seconds() // 60) + 1)
        raise HTTPException(
            status_code=429,
            detail=f"Çok fazla hatalı deneme. Hesap geçici olarak kilitlendi; {mins} dk sonra tekrar dene.",
        )


def register_failure(db: Session, user: User, request: Request | None, event: str = "login_fail") -> None:
    user.failed_logins = (user.failed_logins or 0) + 1
    detail = None
    if user.failed_logins % LOCK_AFTER == 0:
        minutes = LOCK_MINUTES if user.failed_logins == LOCK_AFTER else 60
        user.locked_until = datetime.now(timezone.utc) + timedelta(minutes=minutes)
        detail = f"{user.failed_logins} hatalı deneme → {minutes} dk kilit"
        log_event(db, "locked", user=user, request=request, detail=detail)
        notify_security(db, user, "Hesabına art arda hatalı giriş denendi ve hesap geçici olarak kilitlendi. "
                                  "Bu sen değilsen şifreni değiştir ve iki adımlı doğrulamayı aç.")
    log_event(db, event, user=user, request=request)
    db.commit()


def check_credentials(db: Session, user: User | None, password: str, request: Request) -> User:
    """Parolayi dogrular; kilit, IP siniri ve kayit dahil. Basariliysa kullaniciyi dondurur."""
    ip = client_ip(request)
    if _ip_blocked(ip):
        raise HTTPException(status_code=429, detail="Bu ağdan çok fazla hatalı deneme yapıldı. Biraz sonra tekrar dene.")
    if user is not None:
        ensure_not_locked(user)
    ok = verify_password(password, user.hashed_password if user and user.hashed_password else _DUMMY_HASH)
    if not ok or user is None or not user.hashed_password:
        _ip_fail(ip)
        if user is not None:
            register_failure(db, user, request)
        raise HTTPException(status_code=401, detail="Giriş bilgileri hatalı.")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Bu hesap devre dışı. Yöneticiye başvur.")
    return user


def register_success(db: Session, user: User, request: Request, event: str = "login_ok") -> None:
    user.failed_logins = 0
    user.locked_until = None
    user.last_login_at = datetime.now(timezone.utc)
    log_event(db, event, user=user, request=request)
    db.commit()


# --- TOTP (RFC 6238) ---------------------------------------------------------
TOTP_STEP = 30


def new_totp_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def _hotp(secret: str, counter: int) -> str:
    key = base64.b32decode(secret + "=" * (-len(secret) % 8), casefold=True)
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code = (struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF) % 1_000_000
    return f"{code:06d}"


def totp_now(secret: str, at: float | None = None) -> str:
    return _hotp(secret, int((at or time.time()) // TOTP_STEP))


def totp_match(secret: str, code: str, last_step: int | None = None) -> int | None:
    """Kod gecerliyse kullanilan zaman adimini dondurur (+-1 adim saat kaymasi toleransi).
    last_step'e esit/oncesi adimlar reddedilir: ayni kod ikinci kez kullanilamaz."""
    code = "".join(ch for ch in (code or "") if ch.isdigit())
    if len(code) != 6 or not secret:
        return None
    now = int(time.time() // TOTP_STEP)
    for step in (now - 1, now, now + 1):
        if last_step is not None and step <= last_step:
            continue
        if hmac.compare_digest(_hotp(secret, step), code):
            return step
    return None


def otpauth_uri(secret: str, account: str) -> str:
    label = quote(f"{settings.brand_name}:{account}")
    return f"otpauth://totp/{label}?secret={secret}&issuer={quote(settings.brand_name)}&digits=6&period=30"


def qr_data_uri(text: str) -> str:
    import segno

    return segno.make(text, error="m").png_data_uri(scale=5, border=2, dark="#111111", light="#ffffff")


def new_backup_codes(n: int = 8) -> tuple[list[str], list[str]]:
    """(kullaniciya bir kez gosterilecek kodlar, saklanacak ozetler)."""
    codes = [f"{secrets.token_hex(2)}-{secrets.token_hex(2)}" for _ in range(n)]
    return codes, [_code_hash(c) for c in codes]


def _code_hash(code: str) -> str:
    return hashlib.sha256(code.strip().lower().replace(" ", "").encode()).hexdigest()


def verify_second_factor(db: Session, user: User, code: str) -> bool:
    """TOTP kodu ya da (bir kez kullanilabilen) yedek kod."""
    step = totp_match(user.totp_secret or "", code, user.totp_last_step)
    if step is not None:
        user.totp_last_step = step
        return True
    h = _code_hash(code or "")
    codes = list(user.backup_codes or [])
    if h in codes:
        codes.remove(h)
        user.backup_codes = codes
        return True
    return False


# --- Calisma zamani ayarlari --------------------------------------------------
def get_setting(db: Session, key: str) -> str | None:
    row = db.get(AppSetting, key)
    return row.value if row else None


def set_setting(db: Session, key: str, value: str) -> None:
    row = db.get(AppSetting, key)
    if row:
        row.value = value
    else:
        db.add(AppSetting(key=key, value=value))


def demo_enabled(db: Session) -> bool:
    """Kurucu panelinden kapatilabilir; ayar yoksa env (DEMO_LOGIN / SEED_ON_START)."""
    v = get_setting(db, "demo_login")
    if v is not None:
        return v == "1"
    return settings.demo_login_enabled


# --- Acilis sertlestirmeleri ---------------------------------------------------
_WEAK_SECRETS = {"", "dev-secret-change-me", "change-me", "secret", "changeme"}


def ensure_jwt_secret(db: Session) -> None:
    """JWT_SECRET ayarlanmamis/zayifsa kodda yazan varsayilanla oturum IMZALANMAZ:
    rastgele guclu bir anahtar uretilir ve veritabaninda saklanir (yeniden baslatmada
    oturumlar gecerli kalsin diye). Tercih edilen: Render'da JWT_SECRET ayarlamak."""
    if settings.jwt_secret not in _WEAK_SECRETS and len(settings.jwt_secret) >= 32:
        return
    stored = get_setting(db, "jwt_secret")
    if not stored:
        stored = secrets.token_urlsafe(48)
        set_setting(db, "jwt_secret", stored)
        db.commit()
        print("[guvenlik] JWT_SECRET zayif/ayarsiz: rastgele anahtar uretildi ve DB'de saklandi.")
    settings.jwt_secret = stored


SEED_ADMIN_EMAIL = "admin@kernel.dev"


def neutralize_seed_admin(db: Session) -> None:
    """Eski seed, parolasi repoda yazan bir yonetici hesabi aciyordu (admin@kernel.dev /
    1000). Kurucu olmayan bu hesap kalici olarak devre disi birakilir."""
    u = db.scalar(select(User).where(User.email == SEED_ADMIN_EMAIL))
    if u is None or u.is_founder or (not u.is_active and u.hashed_password is None):
        return
    u.is_active = False
    u.hashed_password = None
    u.token_version = (u.token_version or 0) + 1
    log_event(db, "seed_admin_disabled", user=u, detail="Parolası herkese açık olan eski yönetici hesabı kapatıldı.")
    db.commit()
    print("[guvenlik] Eski seed yonetici hesabi devre disi birakildi.")


def ensure_demo_flags(db: Session) -> None:
    """Seed'in tanitim hesaplari (@kernel.dev) demo olarak isaretli olsun."""
    changed = False
    for u in db.scalars(select(User).where(User.email.like("%@kernel.dev"), User.is_demo.is_(False))):
        u.is_demo = True
        changed = True
    if changed:
        db.commit()


def set_password(user: User, new_password: str) -> None:
    user.hashed_password = hash_password(new_password)
    user.token_version = (user.token_version or 0) + 1
    user.failed_logins = 0
    user.locked_until = None


def purge_old_security_events(db: Session) -> None:
    """Saklama suresi (varsayilan 1 yil) dolan guvenlik kayitlarini siler (KVKK)."""
    from sqlalchemy import delete

    cutoff = datetime.now(timezone.utc) - timedelta(days=settings.security_log_days)
    db.execute(delete(SecurityEvent).where(SecurityEvent.created_at < cutoff))
    db.commit()
