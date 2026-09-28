"""Ogrencinin teslim oncesi on kontrolu.

Akademisyen odevde acarsa (precheck_enabled), ogrenci ZIP'ini TESLIM ETMEDEN
gereksinim kontrolunden gecirebilir. Teslim olusmaz, akademisyene bildirim gitmez.
Kotuye kullanimi ve AI maliyetini sinirlamak icin 24 saatte `precheck_limit` hak.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user
from app.lib import documents
from app.lib.upload import read_upload
from app.lib.ziputil import ZipExtractError, extract_zip
from app.models import Assignment, Enrollment, Precheck, User
from app.routers.insights import _items_of
from app.routers.submissions import _aware, _effective_deadline
from app.services import analysis_service as ana
from app.services.analysis_service import FileBlob

router = APIRouter(tags=["precheck"])

WINDOW = timedelta(hours=24)


def _student_assignment(db: Session, assignment_id: uuid.UUID, user: User) -> Assignment:
    if user.role != "student":
        raise HTTPException(status_code=403, detail="Ön kontrol yalnızca öğrenciler içindir.")
    asg = db.get(Assignment, assignment_id)
    if asg is None:
        raise HTTPException(status_code=404, detail="Ödev bulunamadı.")
    enrolled = db.scalar(select(Enrollment).where(
        Enrollment.class_id == asg.class_id, Enrollment.student_id == user.id))
    if not enrolled:
        raise HTTPException(status_code=403, detail="Bu ödevin sınıfına kayıtlı değilsin.")
    return asg


def _recent(db: Session, asg: Assignment, user: User) -> tuple[list[Precheck], list[Precheck]]:
    """(son 24 saattekiler, tumu) — ikisi de yeniden eskiye."""
    since = datetime.now(timezone.utc) - WINDOW
    rows = db.scalars(
        select(Precheck)
        .where(Precheck.assignment_id == asg.id, Precheck.student_id == user.id)
        .order_by(Precheck.created_at.desc())
    ).all()
    return [p for p in rows if _aware(p.created_at) >= since], rows


def _out(p: Precheck) -> dict:
    s = p.summary_json or {}
    return {
        "id": str(p.id),
        "created_at": _aware(p.created_at).isoformat(),
        "coverage": s.get("coverage"),
        "met": s.get("met_count", 0),
        "partial": s.get("partial_count", 0),
        "missing": s.get("missing_count", 0),
        "headline": s.get("headline", ""),
        "items": _items_of(p.detail_json or {}),
    }


def _status(db: Session, asg: Assignment, user: User) -> dict:
    recent, all_rows = _recent(db, asg, user)
    used = len(recent)
    remaining = max(0, asg.precheck_limit - used)
    resets_at = None
    if remaining == 0 and recent:
        resets_at = (_aware(recent[-1].created_at) + WINDOW).isoformat()  # en eski hak geri gelir
    deadline_open = datetime.now(timezone.utc) <= _effective_deadline(db, asg, user.id)
    reason = None
    if not asg.precheck_enabled:
        reason = "Bu ödevde ön kontrol kapalı."
    elif not (asg.requirements_json or []):
        reason = "Bu ödevde kontrol edilecek gereksinim tanımlı değil."
    elif not deadline_open:
        reason = "Teslim süresi doldu."
    return {
        "enabled": bool(asg.precheck_enabled),
        "available": reason is None,
        "reason": reason,
        "limit": asg.precheck_limit,
        "used": used,
        "remaining": remaining,
        "resets_at": resets_at,
        "history": [_out(p) for p in all_rows[:10]],
    }


@router.get("/assignments/{assignment_id}/precheck")
def precheck_status(
    assignment_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    asg = _student_assignment(db, assignment_id, user)
    return _status(db, asg, user)


@router.post("/assignments/{assignment_id}/precheck")
def run_precheck(
    assignment_id: uuid.UUID,
    file: UploadFile | None = File(None),
    files: list[UploadFile] | None = File(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    asg = _student_assignment(db, assignment_id, user)
    st = _status(db, asg, user)
    if not st["available"]:
        raise HTTPException(status_code=403, detail=st["reason"])
    if st["remaining"] <= 0:
        raise HTTPException(
            status_code=429,
            detail=f"24 saatlik ön kontrol hakkın doldu ({asg.precheck_limit}/{asg.precheck_limit}). "
                   "Biraz sonra tekrar deneyebilirsin.",
        )

    data = read_upload(file, files)
    try:
        files, _tree = extract_zip(data)
    except ZipExtractError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if asg.submission_kind == "document":
        err = documents.document_kind_error([f.path for f in files])
        if err:
            raise HTTPException(status_code=400, detail=err)
    blobs = [FileBlob(path=f.path, content=f.content or f.extracted_text or "") for f in files]
    result = ana.requirement_check(blobs, list(asg.requirements_json or []))
    p = Precheck(
        assignment_id=asg.id,
        student_id=user.id,
        file_count=len(files),
        summary_json=result["summary"],
        detail_json=result["detail"],
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return {"result": _out(p), "status": _status(db, asg, user)}
