"""Odev tanimlama, listeleme ve deadline yeniden acma (reopen).

Sprint 0 kapsami: akademisyenin odev + teslim tarihi + (opsiyonel) gereksinim
listesi tanimlamasi. Ogrenci yukleme akisi Sprint 1'de eklenecek.
"""
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, require_roles
from app.models import (
    AiAnalysis,
    AiChatMessage,
    Assignment,
    AssignmentReopen,
    Class,
    Comment,
    Enrollment,
    Notification,
    PlagiarismMatch,
    Precheck,
    Score,
    Submission,
    SubmissionFile,
    User,
)
from app.schemas import (
    AssignmentIn,
    AssignmentOut,
    AssignmentUpdate,
    ParseRequirementsIn,
    ParseRequirementsOut,
    ReopenIn,
    ReopenOut,
)
from app.routers.submissions import _aware
from app.lib.classinfo import class_courses, course_names
from app.services import analysis_service as ana
from app.services.notifications import create_notification
from app.services.purge import purge_assignment
from app.services.storage_service import get_storage_provider

router = APIRouter(prefix="/assignments", tags=["assignments"])


def _with_effective_deadline(db: Session, rows, user: User) -> list[AssignmentOut]:
    """Uzatmalari (reopen) hesaba katan gecerli son tarihi ekler: ogrenci icin
    kendisine ozel + tum sinif uzatmasi, hoca icin tum sinif uzatmasi. Arayuz
    "Acik / Suresi doldu" kararini bu alana gore verir (yukleme de buna gore acilir)."""
    ids = [a.id for a in rows]
    latest: dict = {}
    if ids:
        who = AssignmentReopen.student_id.is_(None)
        if user.role == "student":
            who = who | (AssignmentReopen.student_id == user.id)
        for aid, until in db.execute(
            select(AssignmentReopen.assignment_id, func.max(AssignmentReopen.reopened_until))
            .where(AssignmentReopen.assignment_id.in_(ids), who)
            .group_by(AssignmentReopen.assignment_id)
        ):
            latest[aid] = _aware(until)
    names = course_names(db, [a.course_id for a in rows])
    out = []
    for a in rows:
        o = AssignmentOut.model_validate(a)
        o.course_name = names.get(a.course_id)
        base = _aware(a.deadline_at)
        # Ikisi de saat dilimli dondurulur; SQLite'in dusurdugu tz yuzunden
        # istemci iki tarihi farkli yorumlayip sahte "uzatildi" gostermesin.
        o.deadline_at = base
        o.effective_deadline_at = max(base, latest[a.id]) if a.id in latest else base
        out.append(o)
    return out


def _check_can_view(db: Session, cls: Class, user: User) -> None:
    """Akademisyen kendi sinifini, ogrenci kayitli oldugu sinifi gorur."""
    if user.role == "student":
        enrolled = db.scalar(
            select(Enrollment).where(
                Enrollment.class_id == cls.id, Enrollment.student_id == user.id
            )
        )
        if not enrolled:
            raise HTTPException(status_code=403, detail="Bu sinifa kayitli degilsiniz.")
    elif user.role == "academician" and cls.academician_id != user.id:
        raise HTTPException(status_code=403, detail="Bu sinif size ait degil.")


@router.post("/parse-requirements", response_model=ParseRequirementsOut)
def parse_requirements(
    payload: ParseRequirementsIn,
    _: User = Depends(require_roles("academician", "admin")),
) -> ParseRequirementsOut:
    """Serbest odev metnini AI ile temiz, kontrol edilebilir gereksinim maddelerine boler."""
    reqs = ana.parse_requirements(payload.text)
    return ParseRequirementsOut(requirements=reqs)


def _class_owned(db: Session, class_id: uuid.UUID, user: User) -> Class:
    cls = db.get(Class, class_id)
    if cls is None:
        raise HTTPException(status_code=404, detail="Sinif bulunamadi.")
    if user.role != "admin" and cls.academician_id != user.id:
        raise HTTPException(status_code=403, detail="Bu sinif size ait degil.")
    return cls


def _resolve_course(db: Session, cls: Class, course_id: uuid.UUID | None) -> uuid.UUID | None:
    """Ödevin dersi sınıfın derslerinden biri olmalı. Sınıfın tek dersi varsa o seçilir."""
    courses = class_courses(db, cls.id)
    if course_id is not None:
        if course_id not in {c.id for c in courses}:
            raise HTTPException(status_code=400, detail="Bu ders sınıfta yok. Önce dersi sınıfa ekleyin.")
        return course_id
    if len(courses) == 1:
        return courses[0].id
    if courses:
        raise HTTPException(status_code=400, detail="Ödevin hangi derse ait olduğunu seçin.")
    raise HTTPException(status_code=400, detail="Sınıfta henüz ders yok. Önce sınıfa ders ekleyin.")


@router.post("", response_model=AssignmentOut, status_code=201)
def create_assignment(
    payload: AssignmentIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("academician", "admin")),
) -> AssignmentOut:
    cls = _class_owned(db, payload.class_id, user)
    assignment = Assignment(
        class_id=payload.class_id,
        course_id=_resolve_course(db, cls, payload.course_id),
        title=payload.title,
        description=payload.description,
        requirements_json=payload.requirements or None,
        deadline_at=payload.deadline_at,
        created_by=user.id,
        precheck_enabled=payload.precheck_enabled,
        precheck_limit=payload.precheck_limit,
        show_requirement_to_student=payload.show_requirement_to_student,
        show_clean_code_to_student=payload.show_clean_code_to_student,
        submission_kind=payload.submission_kind,
    )
    db.add(assignment)
    db.flush()
    names = course_names(db, [assignment.course_id])
    # Sinifa kayitli tum ogrencilere "yeni odev" bildirimi
    student_ids = db.scalars(
        select(Enrollment.student_id).where(Enrollment.class_id == payload.class_id)
    ).all()
    for sid in student_ids:
        create_notification(
            db, sid, "assignment",
            f"Yeni ödev: '{assignment.title}'"
            + (f" ({names[assignment.course_id]})." if assignment.course_id in names else "."),
            assignment_id=assignment.id,
        )
    db.commit()
    db.refresh(assignment)
    return _with_effective_deadline(db, [assignment], user)[0]


@router.get("", response_model=list[AssignmentOut])
def list_assignments(
    class_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[AssignmentOut]:
    cls = db.get(Class, class_id)
    if cls is None:
        raise HTTPException(status_code=404, detail="Sinif bulunamadi.")
    _check_can_view(db, cls, user)

    rows = db.scalars(
        select(Assignment)
        .where(Assignment.class_id == class_id)
        .order_by(Assignment.deadline_at.desc())
    ).all()
    return _with_effective_deadline(db, rows, user)


@router.patch("/{assignment_id}", response_model=AssignmentOut)
def update_assignment(
    assignment_id: uuid.UUID,
    payload: AssignmentUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("academician", "admin")),
) -> AssignmentOut:
    assignment = db.get(Assignment, assignment_id)
    if assignment is None:
        raise HTTPException(status_code=404, detail="Odev bulunamadi.")
    cls = _class_owned(db, assignment.class_id, user)
    if payload.course_id is not None:
        assignment.course_id = _resolve_course(db, cls, payload.course_id)
    if payload.title is not None:
        assignment.title = payload.title
    if payload.description is not None:
        assignment.description = payload.description or None
    if payload.requirements is not None:
        assignment.requirements_json = payload.requirements or None
    if payload.deadline_at is not None and _aware(payload.deadline_at) != _aware(assignment.deadline_at):
        assignment.deadline_at = payload.deadline_at
        # Tum sinifa verilmis uzatma eski tarihe gore verilmisti; yeni tarih onun
        # yerine gecer (yoksa one cekilen tarih uzatma yuzunden hic uygulanmazdi).
        # Ogrenciye ozel uzatmalar bilincli istisnadir; kalir, listeden iptal edilebilir.
        db.execute(delete(AssignmentReopen).where(
            AssignmentReopen.assignment_id == assignment_id,
            AssignmentReopen.student_id.is_(None),
        ))
    if payload.precheck_enabled is not None:
        assignment.precheck_enabled = payload.precheck_enabled
    if payload.precheck_limit is not None:
        assignment.precheck_limit = payload.precheck_limit
    if payload.show_requirement_to_student is not None:
        assignment.show_requirement_to_student = payload.show_requirement_to_student
    if payload.show_clean_code_to_student is not None:
        assignment.show_clean_code_to_student = payload.show_clean_code_to_student
    if payload.submission_kind is not None:
        assignment.submission_kind = payload.submission_kind
    db.commit()
    db.refresh(assignment)
    return _with_effective_deadline(db, [assignment], user)[0]


@router.delete("/{assignment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_assignment(
    assignment_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("academician", "admin")),
) -> None:
    """Odevi ve tum bagli verilerini (gonderimler, dosyalar, yorumlar, puanlar,
    AI analizleri, mentor sohbetleri, uzatmalar) siler."""
    assignment = db.get(Assignment, assignment_id)
    if assignment is None:
        raise HTTPException(status_code=404, detail="Odev bulunamadi.")
    _class_owned(db, assignment.class_id, user)

    zip_keys = purge_assignment(db, assignment)
    db.commit()
    # Depodaki ham ZIP'ler (best-effort: depolama hatasi silmeyi geri almaz)
    try:
        get_storage_provider().delete(zip_keys)
    except Exception as exc:
        print(f"[storage] odev {assignment_id} ZIP'leri silinemedi: {exc}")


@router.get("/{assignment_id}", response_model=AssignmentOut)
def get_assignment(
    assignment_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AssignmentOut:
    assignment = db.get(Assignment, assignment_id)
    if assignment is None:
        raise HTTPException(status_code=404, detail="Odev bulunamadi.")
    cls = db.get(Class, assignment.class_id)
    if cls is None:
        raise HTTPException(status_code=404, detail="Sinif bulunamadi.")
    _check_can_view(db, cls, user)
    return _with_effective_deadline(db, [assignment], user)[0]


@router.post("/{assignment_id}/reopen", response_model=ReopenOut, status_code=201)
def reopen_assignment(
    assignment_id: uuid.UUID,
    payload: ReopenIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("academician", "admin")),
) -> ReopenOut:
    """Teslim tarihini bir ogrenci (student_id) veya tum sinif (None) icin gecici olarak yeniden acar."""
    assignment = db.get(Assignment, assignment_id)
    if assignment is None:
        raise HTTPException(status_code=404, detail="Odev bulunamadi.")
    _class_owned(db, assignment.class_id, user)

    if _aware(payload.reopened_until) <= datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Yeni son tarih gelecekte olmalı.")
    if payload.student_id is not None:
        student = db.get(User, payload.student_id)
        enrolled = db.scalar(select(Enrollment).where(
            Enrollment.class_id == assignment.class_id, Enrollment.student_id == payload.student_id))
        if student is None or student.role != "student" or enrolled is None:
            raise HTTPException(status_code=404, detail="Öğrenci bu sınıfta değil.")

    reopen = AssignmentReopen(
        assignment_id=assignment_id,
        student_id=payload.student_id,
        reopened_until=payload.reopened_until,
        reopened_by=user.id,
    )
    db.add(reopen)
    # Etkilenen ogrenci(ler)e "teslim uzatildi" bildirimi
    if payload.student_id is not None:
        targets = [payload.student_id]
    else:
        targets = list(
            db.scalars(
                select(Enrollment.student_id).where(Enrollment.class_id == assignment.class_id)
            ).all()
        )
    for sid in targets:
        create_notification(
            db, sid, "reopen",
            f"Teslim süresi uzatıldı: '{assignment.title}'.",
            assignment_id=assignment_id,
        )
    db.commit()
    db.refresh(reopen)
    return _reopen_out(db, reopen)


def _reopen_out(db: Session, r: AssignmentReopen) -> ReopenOut:
    out = ReopenOut.model_validate(r)
    out.reopened_until = _aware(r.reopened_until)
    if r.student_id:
        st = db.get(User, r.student_id)
        out.student_name = st.full_name if st else "Öğrenci"
    out.active = _aware(r.reopened_until) > datetime.now(timezone.utc)
    return out


@router.post("/{assignment_id}/close", response_model=AssignmentOut)
def close_now(
    assignment_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("academician", "admin")),
) -> AssignmentOut:
    """Teslimi HERKES icin simdi kapatir: son tarih = simdi, suresi gecmemis tum
    uzatmalar (sinif + ogrenciye ozel) biter. Hoca isterse sonra yeniden sure verebilir."""
    assignment = db.get(Assignment, assignment_id)
    if assignment is None:
        raise HTTPException(status_code=404, detail="Odev bulunamadi.")
    _class_owned(db, assignment.class_id, user)
    now = datetime.now(timezone.utc)
    active = [r for r in db.scalars(
        select(AssignmentReopen).where(AssignmentReopen.assignment_id == assignment_id)
    ) if _aware(r.reopened_until) > now]
    if _aware(assignment.deadline_at) <= now and not active:
        raise HTTPException(status_code=400, detail="Teslim zaten kapalı.")
    # 1 sn geri: saat cozunurlugu (Windows ~15 ms) yuzunden hemen sonraki yukleme
    # ayni ana denk gelip "tam zamaninda" sayilmasin
    assignment.deadline_at = now - timedelta(seconds=1)
    for r in active:
        db.delete(r)
    for sid in db.scalars(select(Enrollment.student_id).where(Enrollment.class_id == assignment.class_id)):
        create_notification(db, sid, "reopen", f"'{assignment.title}' ödevinin teslimi hoca tarafından kapatıldı.",
                            assignment_id=assignment_id)
    db.commit()
    db.refresh(assignment)
    return _with_effective_deadline(db, [assignment], user)[0]


@router.get("/{assignment_id}/reopens", response_model=list[ReopenOut])
def list_reopens(
    assignment_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("academician", "admin")),
) -> list[ReopenOut]:
    """Verilmis uzatmalar (tum sinif + ogrenciye ozel); en gec biten ustte."""
    assignment = db.get(Assignment, assignment_id)
    if assignment is None:
        raise HTTPException(status_code=404, detail="Odev bulunamadi.")
    _class_owned(db, assignment.class_id, user)
    rows = db.scalars(
        select(AssignmentReopen).where(AssignmentReopen.assignment_id == assignment_id)
        .order_by(AssignmentReopen.reopened_until.desc())
    ).all()
    return [_reopen_out(db, r) for r in rows]


@router.delete("/{assignment_id}/reopens/{reopen_id}", status_code=status.HTTP_204_NO_CONTENT)
def cancel_reopen(
    assignment_id: uuid.UUID,
    reopen_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("academician", "admin")),
) -> None:
    """Uzatmayi iptal eder; etkilenen ogrenci(ler)e bildirim gider."""
    assignment = db.get(Assignment, assignment_id)
    if assignment is None:
        raise HTTPException(status_code=404, detail="Odev bulunamadi.")
    _class_owned(db, assignment.class_id, user)
    r = db.get(AssignmentReopen, reopen_id)
    if r is None or r.assignment_id != assignment_id:
        raise HTTPException(status_code=404, detail="Uzatma bulunamadı.")
    targets = [r.student_id] if r.student_id else list(db.scalars(
        select(Enrollment.student_id).where(Enrollment.class_id == assignment.class_id)).all())
    db.delete(r)
    if _aware(r.reopened_until) > datetime.now(timezone.utc):  # suresi gecmis uzatma icin bildirim anlamsiz
        for sid in targets:
            create_notification(db, sid, "reopen", f"'{assignment.title}' için verilen süre uzatması iptal edildi.",
                                assignment_id=assignment_id)
    db.commit()
