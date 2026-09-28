"""Kimlik dogrulama uc noktalari (yerel saglayici).

AUTH_PROVIDER=supabase oldugunda kayit/giris Supabase tarafinda yapilacagi
icin bu router devre disi birakilip yerine JWT dogrulama kullanilacaktir.

Guvenlik: hatali denemelerde hesap kilidi + IP siniri, iki adimli dogrulama
(TOTP + yedek kodlar), sifre degisince/"tum cihazlardan cik" denince eski
oturumlarin gecersiz olmasi (token_version) ve her olayin kaydi.
"""
import hmac
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.deps import get_current_user
from app.models import SecurityEvent, User, UserSession
from app.schemas import (
    BackupCodesOut,
    ChangePasswordIn,
    CodeIn,
    FounderFinishIn,
    FounderStartIn,
    FounderStartOut,
    FounderStatusOut,
    LoginIn,
    MfaLoginIn,
    PasswordIn,
    SchoolLoginIn,
    SecurityEventOut,
    SecurityOut,
    SessionOut,
    TokenOut,
    TwoFactorDisableIn,
    TwoFactorSetupOut,
    UserOut,
)
from app.security import (
    create_access_token,
    create_purpose_token,
    decode_purpose_token,
    hash_password,
    verify_password,
)
from app.services import account_security as sec
from app.services import sessions
from app.universities import UNIVERSITIES

router = APIRouter(prefix="/auth", tags=["auth"])


def _ensure_local_auth() -> None:
    if settings.auth_provider != "local":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Kayit/giris yerel auth saglayicisi disinda desteklenmez.",
        )


DEMO_ACCOUNTS = {"academician": "9001", "student": "2025001"}
MFA_MINUTES = 5


def _session(db: Session, user: User, request: Request, response: Response, remember: bool = True) -> TokenOut:
    """Yeni cihaz oturumu (web: httpOnly cerez) + erisim token'i."""
    token = sessions.start(db, user, request, response, remember)
    return TokenOut(access_token=token, user=UserOut.model_validate(user))


def _finish_login(db: Session, user: User | None, password: str, request: Request,
                  response: Response, remember: bool) -> TokenOut:
    """Ortak giris: parola + kilit + IP siniri; 2FA aciksa once kod adimi."""
    user = sec.check_credentials(db, user, password, request)
    if user.role == "admin" and not user.totp_enabled:
        # Yonetici hesabi iki adimli dogrulama olmadan acilamaz (kurucu kurulumda acar).
        raise HTTPException(status_code=403, detail="Yönetici hesabı için iki adımlı doğrulama zorunlu.")
    if user.totp_enabled:
        # Parola dogru ama oturum henuz yok: kisa omurlu ara token
        mfa = create_purpose_token({"sub": str(user.id), "tv": user.token_version or 0}, "mfa", MFA_MINUTES)
        return TokenOut(mfa_required=True, mfa_token=mfa)
    sec.register_success(db, user, request)
    return _session(db, user, request, response, remember)


def _user_from_claims(db: Session, data: dict | None) -> User | None:
    if not data:
        return None
    try:
        user = db.get(User, uuid.UUID(str(data.get("sub"))))
    except (ValueError, TypeError):
        return None
    if user is None or not user.is_active or data.get("tv", 0) != (user.token_version or 0):
        return None
    return user


@router.get("/demo")
def demo_info(db: Session = Depends(get_db)) -> dict:
    """Giris ekrani tek tik demo dugmelerini gostersin mi? (sifre gondermez)"""
    return {"enabled": sec.demo_enabled(db) and settings.auth_provider == "local"}


@router.post("/demo-login", response_model=TokenOut)
def demo_login(payload: dict, request: Request, response: Response, db: Session = Depends(get_db)) -> TokenOut:
    """Tanitim icin tek tik giris: yalnizca demo acikken ve yalnizca demo hesaplara."""
    _ensure_local_auth()
    if not sec.demo_enabled(db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Demo girişi kapalı.")
    school_no = DEMO_ACCOUNTS.get(str(payload.get("role")))
    user = (db.scalar(select(User).where(User.school_no == school_no, User.is_demo.is_(True)))
            if school_no else None)
    if user is None or not user.is_active or user.role == "admin":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Demo hesabı bulunamadı.")
    return _session(db, user, request, response, remember=False)


@router.get("/universities", response_model=list[str])
def universities() -> list[str]:
    """Giris ekranindaki universite listesi (demo).

    Gercek OBS/Proliz API'si baglaninca burasi o API'ye devredilecek.
    """
    return UNIVERSITIES


@router.post("/login", response_model=TokenOut)
def login(payload: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)) -> TokenOut:
    """E-posta ile giris: YALNIZCA kurucu/yonetici. Diger hesaplar okul no ile girer;
    burada hic yokmus gibi davranilir (hangi e-postanin yonetici oldugu anlasilmaz)."""
    _ensure_local_auth()
    user = db.scalar(select(User).where(User.email == payload.email.lower(), User.role == "admin"))
    return _finish_login(db, user, payload.password, request, response, payload.remember)


@router.post("/login-school", response_model=TokenOut)
def login_school(payload: SchoolLoginIn, request: Request, response: Response,
                 db: Session = Depends(get_db)) -> TokenOut:
    """Proliz/OBS tarzi giris: universite + okul no + sifre (OBS baglaninca oraya devredilecek)."""
    _ensure_local_auth()
    user = db.scalar(select(User).where(User.school_no == payload.school_no.strip()))
    return _finish_login(db, user, payload.password, request, response, payload.remember)


@router.post("/login/2fa", response_model=TokenOut)
def login_second_factor(payload: MfaLoginIn, request: Request, response: Response,
                        db: Session = Depends(get_db)) -> TokenOut:
    """Girisin ikinci adimi: dogrulayici uygulamadaki 6 haneli kod ya da yedek kod."""
    user = _user_from_claims(db, decode_purpose_token(payload.mfa_token, "mfa"))
    if user is None or not user.totp_enabled:
        raise HTTPException(status_code=401, detail="Doğrulama süresi doldu. Yeniden giriş yap.")
    sec.ensure_not_locked(user)
    if not sec.verify_second_factor(db, user, payload.code):
        sec.register_failure(db, user, request, event="2fa_fail")
        raise HTTPException(status_code=401, detail="Kod hatalı.")
    sec.register_success(db, user, request)
    return _session(db, user, request, response, payload.remember)


@router.post("/refresh", response_model=TokenOut)
def refresh(request: Request, response: Response, db: Session = Depends(get_db)) -> TokenOut:
    """Web: httpOnly cerezdeki oturumdan yeni kisa omurlu erisim token'i (sayfa acilisinda
    ve token dolunca). Ozel baslik zorunlu: baska siteden tetiklenemez."""
    try:
        user, s = sessions.refresh(db, request)
    except HTTPException:
        sessions.clear_cookie(response)
        raise
    return TokenOut(access_token=sessions.access_token_for(user, s), user=UserOut.model_validate(user))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, db: Session = Depends(get_db)) -> Response:
    """Bu cihazdaki oturumu kapatir (web: cerez; mobil: token'daki oturum)."""
    s = sessions.from_cookie(db, request)
    if s is None:
        auth = request.headers.get("authorization", "")
        data = None
        if auth.lower().startswith("bearer "):
            try:
                from app.security import decode_token

                data = decode_token(auth[7:])
            except Exception:
                data = None
        if data and data.get("sid") and not data.get("purpose"):
            try:
                s = db.get(UserSession, uuid.UUID(str(data["sid"])))
            except (ValueError, TypeError):
                s = None
    if s is not None:
        sessions.revoke(db, s)
        db.commit()
    resp = Response(status_code=status.HTTP_204_NO_CONTENT)
    sessions.clear_cookie(resp)
    return resp


@router.get("/sessions", response_model=list[SessionOut])
def my_sessions(request: Request, db: Session = Depends(get_db),
                user: User = Depends(get_current_user)) -> list[SessionOut]:
    """Hesabin acik oturumlari (cihazlar). Tanimadigin bir cihazi kapatabilirsin."""
    current = getattr(request.state, "sid", None)
    if user.is_demo:
        return []  # ortak demo hesabi: diger ziyaretcilerin oturumlari gosterilmez/kapatilamaz
    return [SessionOut(id=s.id, client=s.client, device=sessions.device_label(s.user_agent), ip=s.ip,
                       created_at=s.created_at, last_seen_at=s.last_seen_at, current=str(s.id) == str(current))
            for s in sessions.active(db, user)]


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def close_session(session_id: uuid.UUID, request: Request, db: Session = Depends(get_db),
                  user: User = Depends(get_current_user)) -> Response:
    _not_demo(user)
    s = db.get(UserSession, session_id)
    if s is None or s.user_id != user.id:
        raise HTTPException(status_code=404, detail="Oturum bulunamadı.")
    sessions.revoke(db, s)
    sec.log_event(db, "session_closed", user=user, request=request, detail=sessions.device_label(s.user_agent))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(user)


# --- Kendi hesabinin guvenligi -------------------------------------------------
def _not_demo(user: User) -> None:
    if user.is_demo:
        raise HTTPException(status_code=403, detail="Demo hesabında bu işlem yapılamaz (hesap herkese açık).")


def _check_password_and_code(db: Session, user: User, password: str, code: str | None,
                             request: Request, event: str) -> None:
    """Hassas islemler icin yeniden dogrulama (calinan bir oturum tek basina yetmesin)."""
    sec.ensure_not_locked(user)
    ok = bool(user.hashed_password) and verify_password(password, user.hashed_password)
    if ok and code is not None:
        ok = sec.verify_second_factor(db, user, code)
    if not ok:
        sec.register_failure(db, user, request, event=event)
        raise HTTPException(status_code=400, detail="Şifre veya kod hatalı." if code is not None else "Şifre hatalı.")


@router.post("/change-password", response_model=TokenOut)
def change_password(payload: ChangePasswordIn, request: Request, db: Session = Depends(get_db),
                    user: User = Depends(get_current_user)) -> TokenOut:
    """Sifre degisimi: diger tum cihazlardaki oturumlar kapanir, bu cihaz icin yeni token doner."""
    _not_demo(user)
    _check_password_and_code(db, user, payload.current_password, None, request, "password_change_fail")
    if verify_password(payload.new_password, user.hashed_password or ""):
        raise HTTPException(status_code=400, detail="Yeni şifre eskisiyle aynı olamaz.")
    min_len = sec.MIN_FOUNDER_PASSWORD if user.role == "admin" else sec.MIN_PASSWORD
    sec.check_password(payload.new_password, hints=(user.school_no, user.email, user.full_name), min_len=min_len)
    sec.set_password(user, payload.new_password)
    user.must_change_password = False
    current = _current_session(db, request, user)
    sessions.revoke_all(db, user, keep=current.id if current else None)
    sec.log_event(db, "password_changed", user=user, request=request)
    sec.notify_security(db, user, "Şifren değiştirildi ve diğer cihazlardaki oturumların kapatıldı. "
                                  "Bu işlemi sen yapmadıysan hemen yöneticiye başvur.")
    db.commit()
    db.refresh(user)
    if current is not None:
        return TokenOut(access_token=sessions.access_token_for(user, current), user=UserOut.model_validate(user))
    token = create_access_token(str(user.id), user.role, user.token_version or 0)
    return TokenOut(access_token=token, user=UserOut.model_validate(user))


def _current_session(db: Session, request: Request, user: User) -> UserSession | None:
    sid = getattr(request.state, "sid", None)
    if not sid:
        return None
    try:
        s = db.get(UserSession, uuid.UUID(str(sid)))
    except (ValueError, TypeError):
        return None
    return s if sessions.is_valid(s, user.id) else None


@router.post("/logout-all", status_code=status.HTTP_204_NO_CONTENT)
def logout_all(request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> Response:
    """Tum cihazlardaki oturumlari (bu cihaz dahil) kapatir."""
    _not_demo(user)  # ortak demo hesabinda baskalarinin (or. sunum yapan hocanin) oturumunu dusurmesin
    user.token_version = (user.token_version or 0) + 1
    sessions.revoke_all(db, user)
    sec.log_event(db, "logout_all", user=user, request=request)
    db.commit()
    resp = Response(status_code=status.HTTP_204_NO_CONTENT)
    sessions.clear_cookie(resp)
    return resp


def event_out(e: SecurityEvent, names: dict | None = None) -> SecurityEventOut:
    names = names or {}
    return SecurityEventOut(id=e.id, event=e.event, ip=e.ip, user_agent=e.user_agent, detail=e.detail,
                            created_at=e.created_at, user_id=e.user_id,
                            user_name=names.get(e.user_id), actor_name=names.get(e.actor_id))


@router.get("/security", response_model=SecurityOut)
def my_security(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> SecurityOut:
    """Hesabin guvenlik durumu + son 15 olay (girisler, hatali denemeler...)."""
    events = db.scalars(
        select(SecurityEvent).where(SecurityEvent.user_id == user.id)
        .order_by(SecurityEvent.created_at.desc()).limit(15)
    ).all()
    actor_ids = {e.actor_id for e in events if e.actor_id}
    names = dict(db.execute(select(User.id, User.full_name).where(User.id.in_(actor_ids))).all()) if actor_ids else {}
    return SecurityOut(totp_enabled=user.totp_enabled, backup_codes_left=len(user.backup_codes or []),
                       is_demo=user.is_demo, events=[event_out(e, names) for e in events])


@router.post("/2fa/setup", response_model=TwoFactorSetupOut)
def two_factor_setup(payload: PasswordIn, request: Request, db: Session = Depends(get_db),
                     user: User = Depends(get_current_user)) -> TwoFactorSetupOut:
    """Dogrulayici uygulama icin yeni anahtar (henuz aktif degil; /2fa/enable ile acilir).
    Sifre istenir: calinmis bir oturumla 2FA acilip sahibi disarida birakilamasin."""
    _not_demo(user)
    if user.totp_enabled:
        raise HTTPException(status_code=400, detail="İki adımlı doğrulama zaten açık.")
    _check_password_and_code(db, user, payload.password, None, request, "2fa_setup_fail")
    user.totp_secret = sec.new_totp_secret()
    user.totp_last_step = None
    db.commit()
    uri = sec.otpauth_uri(user.totp_secret, user.school_no or user.email)
    return TwoFactorSetupOut(secret=user.totp_secret, otpauth_uri=uri, qr=sec.qr_data_uri(uri))


@router.post("/2fa/enable", response_model=BackupCodesOut)
def two_factor_enable(payload: CodeIn, request: Request, db: Session = Depends(get_db),
                      user: User = Depends(get_current_user)) -> BackupCodesOut:
    _not_demo(user)
    if user.totp_enabled or not user.totp_secret:
        raise HTTPException(status_code=400, detail="Önce kurulumu başlat.")
    step = sec.totp_match(user.totp_secret, payload.code)
    if step is None:
        raise HTTPException(status_code=400, detail="Kod hatalı. Uygulamadaki güncel kodu gir.")
    codes, hashes = sec.new_backup_codes()
    user.totp_enabled = True
    user.totp_last_step = step
    user.backup_codes = hashes
    sec.log_event(db, "2fa_enabled", user=user, request=request)
    sec.notify_security(db, user, "İki adımlı doğrulama açıldı. Yedek kodlarını güvenli bir yerde sakla.")
    db.commit()
    return BackupCodesOut(backup_codes=codes)


@router.post("/2fa/disable", status_code=status.HTTP_204_NO_CONTENT)
def two_factor_disable(payload: TwoFactorDisableIn, request: Request, db: Session = Depends(get_db),
                       user: User = Depends(get_current_user)) -> Response:
    if user.role == "admin":
        raise HTTPException(status_code=403, detail="Yönetici hesabında iki adımlı doğrulama kapatılamaz.")
    if not user.totp_enabled:
        raise HTTPException(status_code=400, detail="İki adımlı doğrulama zaten kapalı.")
    _check_password_and_code(db, user, payload.password, payload.code, request, "2fa_disable_fail")
    user.totp_enabled = False
    user.totp_secret = None
    user.totp_last_step = None
    user.backup_codes = None
    sec.log_event(db, "2fa_disabled", user=user, request=request)
    sec.notify_security(db, user, "İki adımlı doğrulama kapatıldı. Bu işlemi sen yapmadıysan hemen şifreni değiştir.")
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/2fa/backup-codes", response_model=BackupCodesOut)
def regenerate_backup_codes(payload: TwoFactorDisableIn, request: Request, db: Session = Depends(get_db),
                            user: User = Depends(get_current_user)) -> BackupCodesOut:
    """Yeni yedek kodlar (eskiler gecersiz olur). Sifre + guncel kod gerekir."""
    if not user.totp_enabled:
        raise HTTPException(status_code=400, detail="Önce iki adımlı doğrulamayı aç.")
    _check_password_and_code(db, user, payload.password, payload.code, request, "2fa_codes_fail")
    codes, hashes = sec.new_backup_codes()
    user.backup_codes = hashes
    sec.log_event(db, "backup_codes_renewed", user=user, request=request)
    db.commit()
    return BackupCodesOut(backup_codes=codes)


# --- Kurucu hesabi (bir kez) ---------------------------------------------------
def founder_setup_open(db: Session) -> bool:
    token = settings.founder_setup_token or ""
    if len(token) < 24 or settings.auth_provider != "local":
        return False
    return db.scalar(select(User.id).where(User.is_founder.is_(True))) is None


@router.get("/founder-setup", response_model=FounderStatusOut)
def founder_setup_status(db: Session = Depends(get_db)) -> FounderStatusOut:
    if founder_setup_open(db):
        return FounderStatusOut(available=True)
    token = settings.founder_setup_token or ""
    # Kurucu varsa bunu disariya soyleme ("closed"): yonetici hesabi aranmasin.
    reason = ("provider" if settings.auth_provider != "local" else "no_token" if not token
              else "short_token" if len(token) < 24 else "closed")
    return FounderStatusOut(available=False, reason=reason)


@router.post("/founder-setup/start", response_model=FounderStartOut)
def founder_setup_start(payload: FounderStartIn, request: Request, db: Session = Depends(get_db)) -> FounderStartOut:
    """1. adim: kurulum anahtari + bilgiler dogrulanir, dogrulayici uygulama anahtari verilir.
    Hesap henuz OLUSMAZ; 2. adimda uygulamadaki kod dogrulaninca olusur."""
    if not founder_setup_open(db):
        raise HTTPException(status_code=404, detail="Kurulum kapalı.")
    if sec.ip_blocked(request):
        raise HTTPException(status_code=429, detail="Çok fazla hatalı deneme. Biraz sonra tekrar dene.")
    if not hmac.compare_digest(payload.setup_token.strip().encode(), settings.founder_setup_token.encode()):
        sec.ip_fail(request)
        sec.log_event(db, "founder_setup_fail", request=request)
        db.commit()
        raise HTTPException(status_code=403, detail="Kurulum anahtarı hatalı.")
    email = payload.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status_code=409, detail="Bu e-posta ile bir kullanıcı zaten var.")
    sec.check_password(payload.password, hints=(email, payload.full_name), min_len=sec.MIN_FOUNDER_PASSWORD)
    secret = sec.new_totp_secret()
    setup_id = create_purpose_token(
        {"name": payload.full_name.strip(), "email": email, "pw": hash_password(payload.password), "totp": secret},
        "founder_setup", 15,
    )
    uri = sec.otpauth_uri(secret, email)
    return FounderStartOut(setup_id=setup_id, secret=secret, otpauth_uri=uri, qr=sec.qr_data_uri(uri))


@router.post("/founder-setup/finish", response_model=BackupCodesOut)
def founder_setup_finish(payload: FounderFinishIn, request: Request, db: Session = Depends(get_db)) -> BackupCodesOut:
    """2. adim: uygulamadaki kod dogruysa kurucu hesabi olusur; yedek kodlar bir kez gosterilir."""
    if not founder_setup_open(db):
        raise HTTPException(status_code=404, detail="Kurulum kapalı.")
    data = decode_purpose_token(payload.setup_id, "founder_setup")
    if not data:
        raise HTTPException(status_code=400, detail="Kurulum süresi doldu; baştan başla.")
    step = sec.totp_match(data["totp"], payload.code)
    if step is None:
        raise HTTPException(status_code=400, detail="Kod hatalı. Uygulamadaki güncel kodu gir.")
    if db.scalar(select(User).where(User.email == data["email"])):
        raise HTTPException(status_code=409, detail="Bu e-posta ile bir kullanıcı zaten var.")
    codes, hashes = sec.new_backup_codes()
    user = User(
        email=data["email"], full_name=data["name"], role="admin", is_founder=True,
        hashed_password=data["pw"], totp_secret=data["totp"], totp_enabled=True,
        totp_last_step=step, backup_codes=hashes,
    )
    db.add(user)
    db.flush()
    sec.log_event(db, "founder_created", user=user, request=request)
    db.commit()
    return BackupCodesOut(backup_codes=codes)
