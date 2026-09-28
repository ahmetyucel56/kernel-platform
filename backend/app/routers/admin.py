"""Kurucu / yonetici paneli: kullanicilar, guvenlik kayitlari, sistem ayarlari.

Yonetici (admin) rolu zaten tum siniflari, odevleri, teslimleri ve topluluklari
gorebilir (ilgili router'lardaki admin istisnalari). Buradaki uc noktalar hesap
yonetimi icindir. Yonetici hesabi yalnizca kurucu kurulumuyla olusur ve iki
adimli dogrulama olmadan giris yapamaz.
"""
import re
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.deps import require_roles
from app.models import (
    AiAnalysis,
    Assignment,
    Class,
    Community,
    SecurityEvent,
    Submission,
    User,
)
from app.routers.auth import event_out, founder_setup_open
from app.schemas import (
    AdminSettingsIn,
    AdminSettingsOut,
    AdminStatsOut,
    AdminUserCreate,
    AdminUserOut,
    AdminUserPatch,
    SecurityEventOut,
    TempPasswordOut,
)
from app.services import account_security as sec
from app.services import sessions
from app.services.purge import purge_user
from app.services.storage_service import get_storage_provider

router = APIRouter(prefix="/admin", tags=["admin"])
require_admin = require_roles("admin")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _out(u: User) -> AdminUserOut:
    out = AdminUserOut.model_validate(u)
    until = sec._aware(u.locked_until)
    out.locked = bool(until and until > _now())
    return out


def _target(db: Session, user_id: uuid.UUID, admin: User) -> User:
    u = db.get(User, user_id)
    if u is None:
        raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı.")
    if u.id == admin.id or u.is_founder or u.role == "admin":
        raise HTTPException(status_code=403, detail="Yönetici hesapları bu panelden değiştirilemez.")
    return u


_ROLE_TR = {"student": "öğrenci", "academician": "akademisyen", "admin": "yönetici"}


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", text.lower())[:20] or "okul"


@router.get("/stats", response_model=AdminStatsOut)
def stats(db: Session = Depends(get_db), _: User = Depends(require_admin)) -> AdminStatsOut:
    count = lambda stmt: db.scalar(stmt) or 0  # noqa: E731
    by_role = dict(db.execute(select(User.role, func.count()).group_by(User.role)).all())
    return AdminStatsOut(
        users={r: int(by_role.get(r, 0)) for r in ("student", "academician", "admin")},
        demo_users=count(select(func.count()).select_from(User).where(User.is_demo.is_(True))),
        inactive_users=count(select(func.count()).select_from(User).where(User.is_active.is_(False))),
        locked_users=count(select(func.count()).select_from(User).where(User.locked_until > _now())),
        classes=count(select(func.count()).select_from(Class)),
        assignments=count(select(func.count()).select_from(Assignment)),
        submissions=count(select(func.count()).select_from(Submission)),
        analyses_7d=count(select(func.count()).select_from(AiAnalysis)
                          .where(AiAnalysis.created_at > _now() - timedelta(days=7))),
        communities=count(select(func.count()).select_from(Community)),
        failed_logins_24h=count(select(func.count()).select_from(SecurityEvent).where(
            SecurityEvent.event.in_(("login_fail", "2fa_fail")),
            SecurityEvent.created_at > _now() - timedelta(hours=24))),
    )


@router.get("/users", response_model=list[AdminUserOut])
def list_users(
    q: str | None = None,
    role: str | None = None,
    kind: str | None = None,  # demo | normal | inactive | locked
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> list[AdminUserOut]:
    stmt = select(User)
    if q and q.strip():
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(or_(func.lower(User.full_name).like(like), func.lower(User.email).like(like),
                              User.school_no.like(like)))
    if role in ("student", "academician", "admin"):
        stmt = stmt.where(User.role == role)
    if kind == "demo":
        stmt = stmt.where(User.is_demo.is_(True))
    elif kind == "normal":
        stmt = stmt.where(User.is_demo.is_(False))
    elif kind == "inactive":
        stmt = stmt.where(User.is_active.is_(False))
    elif kind == "locked":
        stmt = stmt.where(User.locked_until > _now())
    users = db.scalars(stmt.order_by(User.role, User.full_name).limit(500)).all()
    return [_out(u) for u in users]


@router.post("/users", response_model=TempPasswordOut, status_code=201)
def create_user(payload: AdminUserCreate, request: Request, db: Session = Depends(get_db),
                admin: User = Depends(require_admin)) -> TempPasswordOut:
    """Ogrenci/akademisyen hesabi acar. Gecici sifre YALNIZCA bu yanitta bir kez
    gosterilir; normal hesaplar ilk giriste sifresini degistirmek zorundadir."""
    school_no = payload.school_no.strip()
    if db.scalar(select(User).where(User.school_no == school_no)):
        raise HTTPException(status_code=409, detail="Bu okul/personel numarasıyla bir kullanıcı zaten var.")
    if payload.email:
        email = payload.email.lower()
    else:
        domain = "kernel.dev" if payload.is_demo else ("ogrenci.demo" if payload.role == "student" else "personel.demo")
        email = f"{school_no.lower()}.{_slug(payload.university)}@{domain}"
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status_code=409, detail="Bu e-posta ile bir kullanıcı zaten var.")
    password = sec.temp_password()
    user = User(
        email=email, full_name=payload.full_name.strip(), role=payload.role, school_no=school_no,
        university=payload.university.strip(), is_demo=payload.is_demo,
        must_change_password=not payload.is_demo,  # demo hesabin sifresi degistirilemez
        hashed_password=sec.hash_password(password),
    )
    db.add(user)
    db.flush()
    sec.log_event(db, "user_created", user=user, actor=admin, request=request,
                  detail=f"{'demo ' if payload.is_demo else ''}{_ROLE_TR[payload.role]}")
    db.commit()
    db.refresh(user)
    return TempPasswordOut(user=_out(user), temp_password=password)


@router.patch("/users/{user_id}", response_model=AdminUserOut)
def update_user(user_id: uuid.UUID, payload: AdminUserPatch, request: Request, db: Session = Depends(get_db),
                admin: User = Depends(require_admin)) -> AdminUserOut:
    u = _target(db, user_id, admin)
    changes = []
    if payload.full_name is not None and payload.full_name.strip() != u.full_name:
        u.full_name = payload.full_name.strip()
        changes.append("ad")
    if payload.role is not None and payload.role != u.role:
        if u.role == "academician" and db.scalar(select(Class.id).where(Class.academician_id == u.id)):
            raise HTTPException(status_code=400, detail="Bu hocanın sınıfları var; önce sınıfları silin.")
        u.role = payload.role
        u.token_version = (u.token_version or 0) + 1
        changes.append(f"rol → {_ROLE_TR[payload.role]}")
    if payload.is_active is not None and payload.is_active != u.is_active:
        u.is_active = payload.is_active
        if not payload.is_active:
            u.token_version = (u.token_version or 0) + 1  # acik oturumlar hemen kapanir
            sessions.revoke_all(db, u)
        changes.append("etkin" if payload.is_active else "devre dışı")
    if changes:
        sec.log_event(db, "user_updated", user=u, actor=admin, request=request, detail=", ".join(changes))
        db.commit()
        db.refresh(u)
    return _out(u)


@router.post("/users/{user_id}/reset-password", response_model=TempPasswordOut)
def reset_password(user_id: uuid.UUID, request: Request, db: Session = Depends(get_db),
                   admin: User = Depends(require_admin)) -> TempPasswordOut:
    """Gecici sifre verir (bir kez gosterilir). Acik oturumlari kapanir, kilidi kalkar;
    normal hesap ilk giriste sifresini degistirmek zorundadir."""
    u = _target(db, user_id, admin)
    password = sec.temp_password()
    sec.set_password(u, password)
    u.must_change_password = not u.is_demo
    sessions.revoke_all(db, u)
    sec.log_event(db, "password_reset", user=u, actor=admin, request=request)
    db.commit()
    db.refresh(u)
    return TempPasswordOut(user=_out(u), temp_password=password)


@router.post("/users/{user_id}/logout", status_code=status.HTTP_204_NO_CONTENT)
def force_logout(user_id: uuid.UUID, request: Request, db: Session = Depends(get_db),
                 admin: User = Depends(require_admin)) -> Response:
    u = _target(db, user_id, admin)
    u.token_version = (u.token_version or 0) + 1
    sessions.revoke_all(db, u)
    sec.log_event(db, "forced_logout", user=u, actor=admin, request=request)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/users/{user_id}/unlock", response_model=AdminUserOut)
def unlock(user_id: uuid.UUID, request: Request, db: Session = Depends(get_db),
           admin: User = Depends(require_admin)) -> AdminUserOut:
    u = _target(db, user_id, admin)
    u.failed_logins = 0
    u.locked_until = None
    sec.log_event(db, "unlocked", user=u, actor=admin, request=request)
    db.commit()
    db.refresh(u)
    return _out(u)


@router.post("/users/{user_id}/reset-2fa", response_model=AdminUserOut)
def reset_two_factor(user_id: uuid.UUID, request: Request, db: Session = Depends(get_db),
                     admin: User = Depends(require_admin)) -> AdminUserOut:
    """Telefonunu kaybeden kullanicinin iki adimli dogrulamasini kapatir."""
    u = _target(db, user_id, admin)
    u.totp_enabled = False
    u.totp_secret = None
    u.totp_last_step = None
    u.backup_codes = None
    u.token_version = (u.token_version or 0) + 1
    sessions.revoke_all(db, u)
    sec.log_event(db, "2fa_reset", user=u, actor=admin, request=request)
    sec.notify_security(db, u, "İki adımlı doğrulaman yönetici tarafından sıfırlandı. Yeniden açmanı öneririz.")
    db.commit()
    db.refresh(u)
    return _out(u)


def _delete(db: Session, u: User, admin: User, request: Request) -> list[str]:
    label = f"{u.full_name} ({u.school_no or u.email}, {_ROLE_TR.get(u.role, u.role)}{', demo' if u.is_demo else ''})"
    keys = purge_user(db, u, heir=admin)
    sec.log_event(db, "user_deleted", actor=admin, request=request, detail=label)
    return keys


def _drop_zips(keys: list[str]) -> None:
    try:
        get_storage_provider().delete(keys)
    except Exception as exc:  # depolama hatasi silmeyi geri almaz
        print(f"[storage] silinen kullanici ZIP'leri kaldirilamadi: {exc}")


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(user_id: uuid.UUID, request: Request, db: Session = Depends(get_db),
                admin: User = Depends(require_admin)) -> Response:
    """Kalici silme: hocanin siniflari/odevleri, ogrencinin teslimleri dahil her sey."""
    u = _target(db, user_id, admin)
    keys = _delete(db, u, admin, request)
    db.commit()
    _drop_zips(keys)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/demo/purge", response_model=dict)
def purge_demo(request: Request, db: Session = Depends(get_db), admin: User = Depends(require_admin)) -> dict:
    """Tanitim bittiginde: tum demo hesaplari ve verileri silinir, demo girisi kapanir
    (acilista ornek veri yeniden OLUSTURULMAZ)."""
    demo = db.scalars(select(User).where(User.is_demo.is_(True), User.role != "admin",
                                         User.is_founder.is_(False))).all()
    keys: list[str] = []
    for u in sorted(demo, key=lambda x: x.role != "academician"):  # once hocalar (siniflar)
        keys += _delete(db, u, admin, request)
        db.flush()
    sec.set_setting(db, "demo_login", "0")
    sec.log_event(db, "demo_purged", actor=admin, request=request, detail=f"{len(demo)} demo hesap silindi")
    db.commit()
    _drop_zips(keys)
    return {"deleted": len(demo)}


@router.get("/events", response_model=list[SecurityEventOut])
def events(user_id: uuid.UUID | None = None, only: str | None = None, limit: int = 100,
           db: Session = Depends(get_db), _: User = Depends(require_admin)) -> list[SecurityEventOut]:
    """Guvenlik kayitlari (en yeni once). only=fail: yalnizca hatali/supheli olaylar."""
    stmt = select(SecurityEvent)
    if user_id:
        stmt = stmt.where(SecurityEvent.user_id == user_id)
    if only == "fail":
        stmt = stmt.where(or_(SecurityEvent.event.like("%fail%"), SecurityEvent.event == "locked"))
    rows = db.scalars(stmt.order_by(SecurityEvent.created_at.desc()).limit(max(1, min(limit, 300)))).all()
    ids = {i for e in rows for i in (e.user_id, e.actor_id) if i}
    names = dict(db.execute(select(User.id, User.full_name).where(User.id.in_(ids))).all()) if ids else {}
    return [event_out(e, names) for e in rows]


@router.get("/settings", response_model=AdminSettingsOut)
def get_settings(db: Session = Depends(get_db), _: User = Depends(require_admin)) -> AdminSettingsOut:
    return AdminSettingsOut(
        demo_login=sec.demo_enabled(db),
        jwt_secret_from_env=sec.get_setting(db, "jwt_secret") != settings.jwt_secret,
        founder_setup_open=bool(settings.founder_setup_token) and founder_setup_open(db),
    )


@router.put("/settings", response_model=AdminSettingsOut)
def put_settings(payload: AdminSettingsIn, request: Request, db: Session = Depends(get_db),
                 admin: User = Depends(require_admin)) -> AdminSettingsOut:
    sec.set_setting(db, "demo_login", "1" if payload.demo_login else "0")
    sec.log_event(db, "setting_changed", actor=admin, request=request,
                  detail=f"demo girişi {'açık' if payload.demo_login else 'kapalı'}")
    db.commit()
    return get_settings(db, admin)
