"""Bildirim olusturma yardimcisi.

Olaylar (not verildi, yorum eklendi, yeni gonderim) sonrasi ilgili kullaniciya
bir bildirim kaydi ekler. Cagiran taraf commit eder.
"""
from __future__ import annotations

import re
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Notification, Submission


def create_notification(
    db: Session,
    user_id: uuid.UUID,
    kind: str,
    message: str,
    submission_id: uuid.UUID | None = None,
    assignment_id: uuid.UUID | None = None,
) -> None:
    db.add(
        Notification(
            user_id=user_id,
            kind=kind,
            message=message,
            submission_id=submission_id,
            assignment_id=assignment_id,
        )
    )


def notify_upload(
    db: Session,
    academician_id: uuid.UUID,
    assignment_id: uuid.UUID,
    assignment_title: str,
    submission: Submission,
    student_name: str,
) -> None:
    """Hocaya yukleme bildirimi — gruplanir: ayni odev icin okunmamis bir yukleme
    bildirimi varsa yenisi eklenmez, o guncellenir ("5 yeni yukleme var").
    60 ogrenci x birkac surum bildirim zilini kullanilmaz hale getirmesin."""
    existing = db.scalar(
        select(Notification).where(
            Notification.user_id == academician_id,
            Notification.kind == "submission",
            Notification.assignment_id == assignment_id,
            Notification.is_read.is_(False),
        ).order_by(Notification.created_at.desc()).limit(1)
    )
    latest = f"{student_name}, v{submission.version_number}"
    if existing is None:
        create_notification(
            db, academician_id, "submission",
            f"{student_name}, '{assignment_title}' ödevine v{submission.version_number} yükledi.",
            submission_id=submission.id, assignment_id=assignment_id,
        )
        return
    # Sayac mesajin icinde tutulur: ilk bildirim 1 yuklemeyi temsil eder
    m = re.search(r"(\d+) yeni yükleme", existing.message or "")
    n = (int(m.group(1)) if m else 1) + 1
    existing.message = f"'{assignment_title}' ödevine {n} yeni yükleme var (son: {latest})."
    existing.submission_id = submission.id  # tiklaninca en son yukleme acilir
