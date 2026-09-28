"""Gonderim (submission) akisi — Sprint 1.

- Ogrenci ZIP yukler; sunucu guvenli sekilde acar, dosya agacini + icerikleri
  saklar, versiyon numarasi otomatik artar.
- Teslim tarihi (ve reopen ile uzatmalar) sunucu tarafinda zorlanir.
- Dosya agaci, tek dosya icerigi ve versiyonlar arasi diff endpoint'leri.
"""
from __future__ import annotations

import difflib
import io
import posixpath
import re
import uuid
import zipfile
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.deps import get_current_user
from app.lib import documents
from app.lib.upload import read_upload
from app.lib.ziputil import ZipExtractError, extract_zip
from app.models import (
    AiAnalysis,
    AiChatMessage,
    Assignment,
    AssignmentReopen,
    Class,
    Comment,
    Enrollment,
    PlagiarismMatch,
    Score,
    Submission,
    SubmissionFile,
)
from app.models import User
from app.schemas import (
    PreviewOut,
    AnalysisOut,
    AnalyzeIn,
    ChatMessageIn,
    ChatMessageOut,
    CommentIn,
    CommentOut,
    DiffLine,
    DiffOut,
    FileContentOut,
    ScoreIn,
    ScoreOut,
    SubmissionListItem,
    SubmissionOut,
)
from app.services import analysis_service as ana
from app.services.analysis_service import FileBlob
from app.services.notifications import create_notification, notify_upload
from app.security import DOWNLOAD_TTL_MINUTES, create_download_token, decode_token
from app.services.storage_service import get_storage_provider

router = APIRouter(tags=["submissions"])


# --- Yardimcilar ------------------------------------------------------------
def _aware(dt: datetime) -> datetime:
    """Naive datetime'i UTC kabul et (SQLite tz bilgisini dusurebilir)."""
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def _effective_deadline(db: Session, assignment: Assignment, student_id: uuid.UUID) -> datetime:
    """Odev son tarihi + varsa (ogrenciye ozel veya tum sinif) reopen uzatmalari."""
    base = _aware(assignment.deadline_at)
    latest_reopen = db.scalar(
        select(func.max(AssignmentReopen.reopened_until)).where(
            AssignmentReopen.assignment_id == assignment.id,
            (AssignmentReopen.student_id == student_id)
            | (AssignmentReopen.student_id.is_(None)),
        )
    )
    if latest_reopen is not None:
        latest_reopen = _aware(latest_reopen)
        return max(base, latest_reopen)
    return base


def student_hidden_types(assignment: Assignment | None) -> set[str]:
    """Ogrencinin GORMEDIGI analiz turleri: intihal (baska ogrenci adlari) ve README
    taslagi her zaman; gereksinim kontrolu ve Clean Code hocanin odev ayarina gore."""
    hidden = {ana.PLAGIARISM, ana.README_DRAFT}
    if assignment is not None and not assignment.show_requirement_to_student:
        hidden.add(ana.REQUIREMENT_CHECK)
    if assignment is not None and not assignment.show_clean_code_to_student:
        hidden.add(ana.CLEAN_CODE)
    return hidden


def _class_of_assignment(db: Session, assignment: Assignment) -> Class:
    cls = db.get(Class, assignment.class_id)
    if cls is None:
        raise HTTPException(status_code=404, detail="Sinif bulunamadi.")
    return cls


def _get_submission_or_404(db: Session, submission_id: uuid.UUID) -> Submission:
    sub = db.get(Submission, submission_id)
    if sub is None:
        raise HTTPException(status_code=404, detail="Gonderim bulunamadi.")
    return sub


def _ensure_can_view(db: Session, sub: Submission, user: User) -> None:
    if user.role == "admin":
        return
    if user.role == "student":
        if sub.student_id != user.id:
            raise HTTPException(status_code=403, detail="Bu gonderim size ait degil.")
        return
    # academician: kendi sinifina ait gonderimleri gorebilir
    assignment = db.get(Assignment, sub.assignment_id)
    cls = _class_of_assignment(db, assignment)
    if cls.academician_id != user.id:
        raise HTTPException(status_code=403, detail="Bu gonderim sizin sinifinizda degil.")


# --- Yukleme ----------------------------------------------------------------
@router.post("/assignments/{assignment_id}/submissions", response_model=SubmissionOut, status_code=201)
def upload_submission(
    assignment_id: uuid.UUID,
    file: UploadFile | None = File(None),
    files: list[UploadFile] | None = File(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SubmissionOut:
    """Teslim: tek bir .zip YA DA normal dosyalar / klasor (sunucuda ZIP'e paketlenir)."""
    if user.role != "student":
        raise HTTPException(status_code=403, detail="Yalnizca ogrenciler gonderim yukleyebilir.")

    assignment = db.get(Assignment, assignment_id)
    if assignment is None:
        raise HTTPException(status_code=404, detail="Odev bulunamadi.")

    # Kayit kontrolu
    enrolled = db.scalar(
        select(Enrollment).where(
            Enrollment.class_id == assignment.class_id,
            Enrollment.student_id == user.id,
        )
    )
    if not enrolled:
        raise HTTPException(status_code=403, detail="Bu odevin sinifina kayitli degilsiniz.")

    # Teslim tarihi (reopen dahil) zorunlulugu
    now = datetime.now(timezone.utc)
    deadline = _effective_deadline(db, assignment, user.id)
    if now > deadline:
        raise HTTPException(status_code=403, detail="Teslim suresi doldu. Yukleme kapali.")

    data = read_upload(file, files)

    try:
        files, tree = extract_zip(data)
    except ZipExtractError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if assignment.submission_kind == "document":
        err = documents.document_kind_error([f.path for f in files])
        if err:
            raise HTTPException(status_code=400, detail=err)

    # Versiyon numarasi = mevcut en yuksek + 1
    max_version = db.scalar(
        select(func.max(Submission.version_number)).where(
            Submission.assignment_id == assignment_id,
            Submission.student_id == user.id,
        )
    )
    next_version = (max_version or 0) + 1

    submission = Submission(
        assignment_id=assignment_id,
        student_id=user.id,
        version_number=next_version,
        zip_storage_path="",  # asagida guncellenir
        file_tree_json=tree,
    )
    db.add(submission)
    db.flush()  # submission.id icin

    # Ham ZIP'i storage provider'a yaz (best-effort; kalicilik DB'de).
    try:
        key = get_storage_provider().save(
            f"submissions/{submission.id}/original.zip", data
        )
        submission.zip_storage_path = key
    except Exception as exc:  # storage hatasi gonderimi engellemesin
        submission.zip_storage_path = f"(kaydedilemedi: {exc})"

    # Dosyalari DB'ye yaz
    for f in files:
        db.add(
            SubmissionFile(
                submission_id=submission.id,
                path=f.path,
                content=f.content,
                size_bytes=f.size_bytes,
                is_binary=f.is_binary,
                extracted_text=f.extracted_text,
            )
        )

    # Sinif akademisyenine "yeni gonderim" bildirimi (okunmamis olan varsa gruplanir)
    cls = db.get(Class, assignment.class_id)
    if cls:
        notify_upload(db, cls.academician_id, assignment.id, assignment.title, submission, user.full_name)

    db.commit()
    db.refresh(submission)
    return SubmissionOut.model_validate(submission)


# --- Proje indirme (orijinal ZIP) -------------------------------------------
_TR = str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU")


def _slug(text: str) -> str:
    s = re.sub(r"[^A-Za-z0-9]+", "-", (text or "").translate(_TR)).strip("-")
    return s[:40] or "odev"


def _rebuild_zip(db: Session, sub: Submission) -> bytes:
    """Orijinal ZIP yoksa (eski teslim / gecici disk silinmis) DB'deki iceriklerden
    yeniden paketler. Icerigi saklanmayan (ikili/buyuk) dosyalar bir notta listelenir."""
    rows = db.scalars(
        select(SubmissionFile).where(SubmissionFile.submission_id == sub.id).order_by(SubmissionFile.path)
    ).all()
    missing = []
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for r in rows:
            if r.content is None:
                missing.append(r.path)
                continue
            z.writestr(r.path, r.content)
        if missing:
            z.writestr(
                "KERNEL_NOT.txt",
                "Bu ZIP, orijinal dosya saklanmadigi icin Kernel'deki iceriklerden yeniden "
                "olusturuldu.\nIkili veya cok buyuk oldugu icin icerigi saklanmayan dosyalar:\n\n"
                + "\n".join(f"- {p}" for p in missing) + "\n",
            )
    return buf.getvalue()


@router.post("/submissions/{submission_id}/download-link")
def create_download_link(
    submission_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Tarayicida/telefonda acilabilir, 5 dk gecerli indirme linki (yetki burada kontrol edilir)."""
    sub = _get_submission_or_404(db, submission_id)
    _ensure_can_view(db, sub, user)
    token = create_download_token(str(sub.id), str(user.id))
    return {"url": f"/submissions/{sub.id}/download?token={token}",
            "expires_in": DOWNLOAD_TTL_MINUTES * 60}


@router.get("/submissions/{submission_id}/download")
def download_submission(
    submission_id: uuid.UUID,
    token: str,
    db: Session = Depends(get_db),
) -> Response:
    try:
        payload = decode_token(token)
    except Exception:
        raise HTTPException(status_code=401, detail="İndirme linkinin süresi dolmuş; yeniden dene.")
    if payload.get("purpose") != "download" or payload.get("sub") != str(submission_id):
        raise HTTPException(status_code=401, detail="Geçersiz indirme linki.")
    sub = _get_submission_or_404(db, submission_id)
    try:
        user = db.get(User, uuid.UUID(str(payload.get("uid"))))
    except (ValueError, TypeError):
        user = None
    if user is None:
        raise HTTPException(status_code=401, detail="Geçersiz indirme linki.")
    _ensure_can_view(db, sub, user)  # yetki link acildiginda tekrar dogrulanir

    data = None
    key = sub.zip_storage_path or ""
    if key and not key.startswith("("):
        try:
            data = get_storage_provider().load(key)
        except Exception:
            data = None  # depolama erisilemiyorsa yeniden paketle
    source = "original" if data else "rebuilt"
    if data is None:
        data = _rebuild_zip(db, sub)

    assignment = db.get(Assignment, sub.assignment_id)
    student = db.get(User, sub.student_id)
    who = (student.school_no or _slug(student.full_name)) if student else "ogrenci"
    filename = f"{who}_{_slug(assignment.title if assignment else '')}_v{sub.version_number}.zip"
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"',
                 "X-Kernel-Source": source},
    )


# --- Listeleme / okuma ------------------------------------------------------
@router.get("/assignments/{assignment_id}/submissions", response_model=list[SubmissionListItem])
def list_submissions(
    assignment_id: uuid.UUID,
    student_id: uuid.UUID | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[SubmissionListItem]:
    assignment = db.get(Assignment, assignment_id)
    if assignment is None:
        raise HTTPException(status_code=404, detail="Odev bulunamadi.")

    if user.role == "student":
        target_student = user.id  # ogrenci yalnizca kendi versiyonlarini gorur
    else:
        cls = _class_of_assignment(db, assignment)
        if user.role == "academician" and cls.academician_id != user.id:
            raise HTTPException(status_code=403, detail="Bu sinif size ait degil.")
        target_student = student_id  # None ise tum ogrenciler

    stmt = select(Submission).where(Submission.assignment_id == assignment_id)
    if target_student is not None:
        stmt = stmt.where(Submission.student_id == target_student)
    rows = db.scalars(stmt.order_by(Submission.version_number.desc())).all()
    return [SubmissionListItem.model_validate(r) for r in rows]


@router.get("/submissions/{submission_id}", response_model=SubmissionOut)
def get_submission(
    submission_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SubmissionOut:
    sub = _get_submission_or_404(db, submission_id)
    _ensure_can_view(db, sub, user)
    out = SubmissionOut.model_validate(sub)
    student = db.get(User, sub.student_id)
    assignment = db.get(Assignment, sub.assignment_id)
    out.student_name = student.full_name if student else None
    out.assignment_title = assignment.title if assignment else None
    return out


@router.get("/submissions/{submission_id}/file", response_model=FileContentOut)
def get_submission_file(
    submission_id: uuid.UUID,
    path: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> FileContentOut:
    sub = _get_submission_or_404(db, submission_id)
    _ensure_can_view(db, sub, user)
    f = db.scalar(
        select(SubmissionFile).where(
            SubmissionFile.submission_id == submission_id, SubmissionFile.path == path
        )
    )
    if f is None:
        raise HTTPException(status_code=404, detail="Dosya bulunamadi.")
    return FileContentOut(
        path=f.path, content=f.content, is_binary=f.is_binary, size_bytes=f.size_bytes,
        preview=documents.preview_kind(f.path) if f.is_binary else "none",
        has_text=bool(f.extracted_text),
    )


# --- Belge / görsel önizleme (indirmeden) ------------------------------------
@lru_cache(maxsize=6)
def _zip_bytes(key: str) -> bytes | None:
    """Teslimin aslı (depodaki ZIP); aynı belgenin sayfaları için tekrar indirilmesin diye kısa önbellek."""
    return get_storage_provider().load(key)


def _original_bytes(sub: Submission, path: str) -> bytes | None:
    key = sub.zip_storage_path or ""
    if not key or key.startswith("("):
        return None
    try:
        data = _zip_bytes(key)
    except Exception:
        return None
    if not data:
        return None
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        for info in zf.infolist():
            if not info.is_dir() and posixpath.normpath(info.filename.replace("\\", "/")) == path:
                if info.file_size > settings.max_uncompressed_bytes:
                    return None
                return zf.read(info)
    return None


# Üretilen PDF sayfaları yalnızca bellekte, kısa süre tutulur (depoya yazılmaz: teslim
# silindiğinde arkada kopya kalmasın).
_page_cache: dict[tuple[str, str, int], bytes] = {}


def _render_page(sub: Submission, path: str, raw: bytes, page: int) -> bytes:
    k = (sub.zip_storage_path or "", path, page)
    if k not in _page_cache:
        if len(_page_cache) >= 48:
            _page_cache.pop(next(iter(_page_cache)))
        _page_cache[k] = documents.pdf_page_png(raw, page)[0]
    return _page_cache[k]


@router.get("/submissions/{submission_id}/preview", response_model=PreviewOut)
def preview_file(
    submission_id: uuid.UUID,
    path: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PreviewOut:
    """Görsel, PDF ve DOCX'i indirmeden gösterir. Görsel ve PDF sayfaları kısa ömürlü,
    yalnızca bu teslime özel imzalı adreslerden gelir (<img> başlık gönderemez)."""
    sub = _get_submission_or_404(db, submission_id)
    _ensure_can_view(db, sub, user)
    if _file_content(db, submission_id, path) is None:
        raise HTTPException(status_code=404, detail="Dosya bulunamadi.")
    kind = documents.preview_kind(path)
    if kind == "none":
        return PreviewOut(kind="none", reason="Bu dosya türü için önizleme yok; 'Projeyi indir' ile indirebilirsin.")
    raw = _original_bytes(sub, path)
    if raw is None:
        return PreviewOut(kind="none", reason="Dosyanın aslı bulunamadı; önizleme gösterilemiyor.")
    token = create_download_token(str(sub.id), str(user.id), purpose="preview")
    base = f"/submissions/{sub.id}/raw?path={quote(path)}&token={token}"
    try:
        if kind == "image":
            size = documents.image_size(raw)
            if size is None:
                return PreviewOut(kind="none", reason="Görsel açılamadı.")
            return PreviewOut(kind="image", url=base, width=size[0], height=size[1])
        if kind == "pdf":
            sizes = documents.pdf_page_sizes(raw)
            count = documents.pdf_page_count(raw)
            return PreviewOut(kind="pdf", page_count=count, truncated=count > len(sizes),
                              pages=[{"url": f"{base}&page={i}", "width": w, "height": h}
                                     for i, (w, h) in enumerate(sizes)])
        return PreviewOut(kind="docx", blocks=documents.docx_blocks(raw))
    except Exception:
        return PreviewOut(kind="none", reason="Belge açılamadı (bozuk ya da desteklenmeyen biçim).")


@router.get("/submissions/{submission_id}/raw")
def raw_file(
    submission_id: uuid.UUID,
    path: str,
    token: str,
    page: int | None = None,
    db: Session = Depends(get_db),
) -> Response:
    try:
        payload = decode_token(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Önizleme bağlantısının süresi doldu; sayfayı yenile.")
    if payload.get("purpose") != "preview" or payload.get("sub") != str(submission_id):
        raise HTTPException(status_code=401, detail="Geçersiz önizleme bağlantısı.")
    sub = _get_submission_or_404(db, submission_id)
    try:
        viewer = db.get(User, uuid.UUID(str(payload.get("uid"))))
    except (ValueError, TypeError):
        viewer = None
    if viewer is None or not viewer.is_active:
        raise HTTPException(status_code=401, detail="Geçersiz önizleme bağlantısı.")
    _ensure_can_view(db, sub, viewer)  # yetki her istekte yeniden doğrulanır
    kind = documents.preview_kind(path)
    raw = _original_bytes(sub, path) if kind in ("image", "pdf") else None
    if raw is None:
        raise HTTPException(status_code=404, detail="Önizleme yok.")
    headers = {"Cache-Control": "private, max-age=300", "Content-Disposition": "inline",
               "X-Content-Type-Options": "nosniff"}
    if kind == "image":
        return Response(content=raw, media_type=documents.IMAGE_TYPES[documents.ext_of(path)], headers=headers)
    if page is None or page < 0 or page >= documents.MAX_PDF_PAGES:
        raise HTTPException(status_code=400, detail="Geçersiz sayfa.")
    try:
        png = _render_page(sub, path, raw, page)
    except Exception:
        raise HTTPException(status_code=404, detail="Sayfa bulunamadı.")
    return Response(content=png, media_type="image/png", headers=headers)


# --- Diff -------------------------------------------------------------------
def _file_content(db: Session, submission_id: uuid.UUID, path: str) -> SubmissionFile | None:
    return db.scalar(
        select(SubmissionFile).where(
            SubmissionFile.submission_id == submission_id, SubmissionFile.path == path
        )
    )


@router.get("/submissions/{submission_id}/diff", response_model=DiffOut)
def diff_submission_file(
    submission_id: uuid.UUID,
    path: str,
    against: uuid.UUID | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DiffOut:
    """Bir dosyanin, bu versiyon ile onceki (veya 'against') versiyonu arasindaki farki.

    'against' verilmezse ayni ogrenci/odev icin bir onceki versiyon otomatik secilir.
    """
    to_sub = _get_submission_or_404(db, submission_id)
    _ensure_can_view(db, to_sub, user)

    from_sub: Submission | None
    if against is not None:
        from_sub = _get_submission_or_404(db, against)
        _ensure_can_view(db, from_sub, user)
    else:
        from_sub = db.scalar(
            select(Submission)
            .where(
                Submission.assignment_id == to_sub.assignment_id,
                Submission.student_id == to_sub.student_id,
                Submission.version_number < to_sub.version_number,
            )
            .order_by(Submission.version_number.desc())
            .limit(1)
        )

    to_file = _file_content(db, submission_id, path)
    from_file = _file_content(db, from_sub.id, path) if from_sub else None

    to_binary = to_file.is_binary if to_file else False
    from_binary = from_file.is_binary if from_file else False
    if to_binary or from_binary:
        return DiffOut(
            path=path,
            from_version=from_sub.version_number if from_sub else None,
            to_version=to_sub.version_number,
            changed=(to_file is None) != (from_file is None)
            or (to_file and from_file and to_file.size_bytes != from_file.size_bytes),
            lines=[DiffLine(type="ctx", text="(ikili dosya — diff gösterilemiyor)")],
        )

    a_text = (from_file.content or "") if from_file else ""
    b_text = (to_file.content or "") if to_file else ""
    a_lines = a_text.splitlines()
    b_lines = b_text.splitlines()

    lines: list[DiffLine] = []
    sm = difflib.SequenceMatcher(a=a_lines, b=b_lines, autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            for k in range(i2 - i1):
                lines.append(DiffLine(type="ctx", a=i1 + k + 1, b=j1 + k + 1, text=a_lines[i1 + k]))
        else:
            for k in range(i1, i2):
                lines.append(DiffLine(type="del", a=k + 1, text=a_lines[k]))
            for k in range(j1, j2):
                lines.append(DiffLine(type="add", b=k + 1, text=b_lines[k]))

    changed = any(ln.type != "ctx" for ln in lines)
    return DiffOut(
        path=path,
        from_version=from_sub.version_number if from_sub else None,
        to_version=to_sub.version_number,
        changed=changed,
        lines=lines,
    )


# --- Inceleme: yorum + puan (Sprint 2) --------------------------------------
def _ensure_can_review(db: Session, sub: Submission, user: User) -> None:
    """Yalnizca sinifin akademisyeni (veya admin) yorum/puan ekleyebilir."""
    if user.role == "admin":
        return
    if user.role != "academician":
        raise HTTPException(status_code=403, detail="Bu işlem için yetkiniz yok.")
    assignment = db.get(Assignment, sub.assignment_id)
    cls = _class_of_assignment(db, assignment)
    if cls.academician_id != user.id:
        raise HTTPException(status_code=403, detail="Bu gönderim sizin sınıfınızda değil.")


def _name_map(db: Session, ids: set[uuid.UUID]) -> dict[uuid.UUID, str]:
    if not ids:
        return {}
    rows = db.scalars(select(User).where(User.id.in_(ids))).all()
    return {u.id: u.full_name for u in rows}


@router.post("/submissions/{submission_id}/comments", response_model=CommentOut, status_code=201)
def add_comment(
    submission_id: uuid.UUID,
    payload: CommentIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> CommentOut:
    sub = _get_submission_or_404(db, submission_id)
    _ensure_can_review(db, sub, user)
    comment = Comment(
        submission_id=submission_id,
        author_id=user.id,
        author_type="academician",
        file_path=payload.file_path,
        line_number=payload.line_number,
        body=payload.body,
    )
    db.add(comment)
    # Ogrenciye "yeni geri bildirim" bildirimi (kendisi degilse)
    if sub.student_id != user.id:
        assignment = db.get(Assignment, sub.assignment_id)
        title = assignment.title if assignment else "gönderim"
        create_notification(
            db, sub.student_id, "comment",
            f"'{title}' gönderimine yeni geri bildirim eklendi.",
            submission_id=submission_id, assignment_id=sub.assignment_id,
        )
    db.commit()
    db.refresh(comment)
    out = CommentOut.model_validate(comment)
    out.author_name = user.full_name
    return out


@router.get("/submissions/{submission_id}/comments", response_model=list[CommentOut])
def list_comments(
    submission_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[CommentOut]:
    sub = _get_submission_or_404(db, submission_id)
    _ensure_can_view(db, sub, user)  # ogrenci kendi gonderimindeki yorumlari gorur
    rows = db.scalars(
        select(Comment)
        .where(Comment.submission_id == submission_id)
        .order_by(Comment.created_at.asc())
    ).all()
    names = _name_map(db, {c.author_id for c in rows if c.author_id})
    result = []
    for c in rows:
        out = CommentOut.model_validate(c)
        out.author_name = names.get(c.author_id) if c.author_id else "AI"
        result.append(out)
    return result


@router.post("/submissions/{submission_id}/score", response_model=ScoreOut, status_code=201)
def set_score(
    submission_id: uuid.UUID,
    payload: ScoreIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ScoreOut:
    sub = _get_submission_or_404(db, submission_id)
    _ensure_can_review(db, sub, user)
    score = Score(submission_id=submission_id, score=payload.score, graded_by=user.id)
    db.add(score)
    assignment = db.get(Assignment, sub.assignment_id)
    title = assignment.title if assignment else "ödev"
    create_notification(
        db, sub.student_id, "graded",
        f"'{title}' ödevin {int(payload.score) if payload.score == int(payload.score) else payload.score}/100 olarak notlandırıldı.",
        submission_id=submission_id, assignment_id=sub.assignment_id,
    )
    db.commit()
    db.refresh(score)
    out = ScoreOut.model_validate(score)
    out.grader_name = user.full_name
    return out


@router.get("/submissions/{submission_id}/score", response_model=ScoreOut | None)
def get_score(
    submission_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ScoreOut | None:
    """En guncel puani dondurur (yoksa null)."""
    sub = _get_submission_or_404(db, submission_id)
    _ensure_can_view(db, sub, user)
    score = db.scalar(
        select(Score)
        .where(Score.submission_id == submission_id)
        .order_by(Score.graded_at.desc())
        .limit(1)
    )
    if score is None:
        return None
    out = ScoreOut.model_validate(score)
    grader = db.get(User, score.graded_by)
    out.grader_name = grader.full_name if grader else None
    return out


# --- AI analiz motoru (Sprint 3) — yalnizca akademisyen tetikler -------------
def _load_files(db: Session, submission_id: uuid.UUID) -> list[FileBlob]:
    rows = db.scalars(
        select(SubmissionFile).where(SubmissionFile.submission_id == submission_id)
    ).all()
    # Belgelerde (PDF/DOCX) yapay zekâ çıkarılan metni okur
    return [FileBlob(path=r.path, content=r.content or r.extracted_text or "") for r in rows]


def _latest_submissions_of_others(
    db: Session, assignment_id: uuid.UUID, exclude_student: uuid.UUID
) -> list[Submission]:
    """Odevdeki diger ogrencilerin EN SON gonderimleri (intihal karsilastirmasi icin)."""
    subs = db.scalars(
        select(Submission)
        .where(Submission.assignment_id == assignment_id, Submission.student_id != exclude_student)
        .order_by(Submission.student_id, Submission.version_number.desc())
    ).all()
    seen: set[uuid.UUID] = set()
    latest = []
    for s in subs:
        if s.student_id in seen:
            continue
        seen.add(s.student_id)
        latest.append(s)
    return latest


@router.post("/submissions/{submission_id}/analyze", response_model=AnalysisOut, status_code=201)
def analyze_submission(
    submission_id: uuid.UUID,
    payload: AnalyzeIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AnalysisOut:
    sub = _get_submission_or_404(db, submission_id)
    _ensure_can_review(db, sub, user)  # AI yalnizca akademisyen istegiyle calisir
    assignment = db.get(Assignment, sub.assignment_id)
    files = _load_files(db, submission_id)

    matches_data: list[dict] = []
    if payload.analysis_type == ana.CLEAN_CODE and assignment.submission_kind == "document":
        raise HTTPException(status_code=400, detail="Bu bir rapor/belge ödevi; Clean Code analizi uygulanmaz.")
    if payload.analysis_type == ana.CLEAN_CODE:
        result = ana.clean_code(files)
    elif payload.analysis_type == ana.REQUIREMENT_CHECK:
        result = ana.requirement_check(files, assignment.requirements_json or [])
    elif payload.analysis_type == ana.README_DRAFT:
        # Kaldirildi: hazir README ogrencinin yapmasi gereken isi yapiyordu. README'yi
        # odevin kurali yap ("README kurulumu anlatmali"); gereksinim kontrolu olcer.
        raise HTTPException(
            status_code=400,
            detail="README taslağı kaldırıldı. README'yi ödevin kuralı olarak ekle; gereksinim kontrolü ölçer.",
        )
    elif payload.analysis_type == ana.PLAGIARISM:
        others = [
            {
                "submission_id": o.id,
                "student_name": (db.get(User, o.student_id).full_name if db.get(User, o.student_id) else "Öğrenci"),
                "files": _load_files(db, o.id),
            }
            for o in _latest_submissions_of_others(db, sub.assignment_id, sub.student_id)
        ]
        result = ana.plagiarism(files, others)
        matches_data = result.get("matches", [])
    else:  # pragma: no cover
        raise HTTPException(status_code=400, detail="Bilinmeyen analiz turu.")

    record = AiAnalysis(
        requested_by=user.id,
        scope="single",
        analysis_type=payload.analysis_type,
        target_submission_id=submission_id,
        summary_json=result["summary"],
        detail_json=result["detail"],
    )
    db.add(record)
    db.flush()

    for m in matches_data:
        db.add(
            PlagiarismMatch(
                ai_analysis_id=record.id,
                submission_id=submission_id,
                matched_submission_id=m["submission_id"],
                similarity_score=m["similarity"],
                details_json={"student_name": m["student_name"], "reason": m["reason"]},
            )
        )

    db.commit()
    db.refresh(record)
    return AnalysisOut.model_validate(record)


@router.get("/submissions/{submission_id}/analyses", response_model=list[AnalysisOut])
def list_analyses(
    submission_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[AnalysisOut]:
    """AI analiz sonuclari.

    Akademisyen tumunu gorur. Ogrenci KENDI gonderimindeki analizleri gorebilir
    (akademisyenin urettigi geri bildirimden faydalansin), ancak intihal
    sonuclari (baska ogrenci adlari icerebilir) ve README taslagi (hazir README
    ogrencinin yapmasi gereken isi yapar; "README olmali" kuralini anlamsizlastirir)
    ogrenciye gosterilmez.
    """
    sub = _get_submission_or_404(db, submission_id)
    _ensure_can_view(db, sub, user)  # ogrenci kendi gonderimini gorebilir
    rows = db.scalars(
        select(AiAnalysis)
        .where(AiAnalysis.target_submission_id == submission_id)
        .order_by(AiAnalysis.created_at.desc())
    ).all()
    if user.role == "student":
        hidden = student_hidden_types(db.get(Assignment, sub.assignment_id))
        rows = [r for r in rows if r.analysis_type not in hidden]
    return [AnalysisOut.model_validate(r) for r in rows]


# --- Sinif geneli AI ozet raporu (scope: class) — akademisyen ----------------
def _ensure_assignment_academician(db: Session, assignment: Assignment, user: User) -> None:
    if user.role == "admin":
        return
    if user.role != "academician":
        raise HTTPException(status_code=403, detail="Bu işlem için yetkiniz yok.")
    cls = _class_of_assignment(db, assignment)
    if cls.academician_id != user.id:
        raise HTTPException(status_code=403, detail="Bu ödev sizin sınıfınızda değil.")


def _latest_per_student(db: Session, assignment_id: uuid.UUID) -> list[Submission]:
    subs = db.scalars(
        select(Submission)
        .where(Submission.assignment_id == assignment_id)
        .order_by(Submission.student_id, Submission.version_number.desc())
    ).all()
    seen: set[uuid.UUID] = set()
    latest = []
    for s in subs:
        if s.student_id in seen:
            continue
        seen.add(s.student_id)
        latest.append(s)
    return latest


@router.post("/assignments/{assignment_id}/analyze-class", response_model=AnalysisOut, status_code=201)
def analyze_class(
    assignment_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AnalysisOut:
    assignment = db.get(Assignment, assignment_id)
    if assignment is None:
        raise HTTPException(status_code=404, detail="Ödev bulunamadı.")
    _ensure_assignment_academician(db, assignment, user)

    latest = _latest_per_student(db, assignment_id)
    if not latest:
        raise HTTPException(status_code=400, detail="Bu ödev için henüz gönderim yok.")

    students = [
        {
            "student_name": (db.get(User, s.student_id).full_name if db.get(User, s.student_id) else "Öğrenci"),
            "files": _load_files(db, s.id),
        }
        for s in latest
    ]
    result = ana.class_summary(students)
    result["detail"]["assignment_id"] = str(assignment_id)
    result["detail"]["assignment_title"] = assignment.title

    record = AiAnalysis(
        requested_by=user.id,
        scope="class",
        analysis_type="class_summary",
        target_class_id=assignment.class_id,
        target_submission_id=None,
        summary_json=result["summary"],
        detail_json=result["detail"],
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return AnalysisOut.model_validate(record)


@router.get("/assignments/{assignment_id}/class-analyses", response_model=list[AnalysisOut])
def list_class_analyses(
    assignment_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[AnalysisOut]:
    assignment = db.get(Assignment, assignment_id)
    if assignment is None:
        raise HTTPException(status_code=404, detail="Ödev bulunamadı.")
    _ensure_assignment_academician(db, assignment, user)
    rows = db.scalars(
        select(AiAnalysis)
        .where(
            AiAnalysis.analysis_type == "class_summary",
            AiAnalysis.target_class_id == assignment.class_id,
        )
        .order_by(AiAnalysis.created_at.desc())
    ).all()
    rows = [r for r in rows if (r.detail_json or {}).get("assignment_id") == str(assignment_id)]
    return [AnalysisOut.model_validate(r) for r in rows]


# --- Ogrenci-AI mentor sohbeti (Faz 2, spec 7.7) — yalnizca sahibi ogrenci ---
def _ensure_owner_student(sub: Submission, user: User) -> None:
    if user.role != "student" or sub.student_id != user.id:
        raise HTTPException(
            status_code=403, detail="AI mentor yalnızca kendi gönderiminde kullanılabilir."
        )


@router.get("/submissions/{submission_id}/chat", response_model=list[ChatMessageOut])
def get_chat(
    submission_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[ChatMessageOut]:
    sub = _get_submission_or_404(db, submission_id)
    _ensure_owner_student(sub, user)
    rows = db.scalars(
        select(AiChatMessage)
        .where(AiChatMessage.submission_id == submission_id, AiChatMessage.student_id == user.id)
        .order_by(AiChatMessage.created_at.asc())
    ).all()
    return [ChatMessageOut.model_validate(r) for r in rows]


@router.post("/submissions/{submission_id}/chat", response_model=ChatMessageOut, status_code=201)
def send_chat(
    submission_id: uuid.UUID,
    payload: ChatMessageIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ChatMessageOut:
    sub = _get_submission_or_404(db, submission_id)
    _ensure_owner_student(sub, user)

    # Gunluk sinir: ogrencinin TUM gonderimlerindeki soru sayisi (son 24 saat)
    since = datetime.now(timezone.utc) - timedelta(hours=24)
    asked = sum(
        1 for t in db.scalars(
            select(AiChatMessage.created_at).where(
                AiChatMessage.student_id == user.id, AiChatMessage.role == "user")
        ) if _aware(t) >= since
    )
    if asked >= settings.mentor_daily_limit:
        raise HTTPException(
            status_code=429,
            detail=f"AI mentora 24 saatte en fazla {settings.mentor_daily_limit} soru sorabilirsin. "
                   "Biraz sonra tekrar dene.",
        )

    # Gecmis + kullanici mesajini kaydet
    history_rows = db.scalars(
        select(AiChatMessage)
        .where(AiChatMessage.submission_id == submission_id, AiChatMessage.student_id == user.id)
        .order_by(AiChatMessage.created_at.asc())
    ).all()
    history = [{"role": m.role, "content": m.content} for m in history_rows]

    db.add(AiChatMessage(submission_id=submission_id, student_id=user.id,
                         role="user", content=payload.message))

    files = _load_files(db, submission_id)
    reply_text = ana.mentor_reply(history, files, payload.message)

    assistant = AiChatMessage(submission_id=submission_id, student_id=user.id,
                              role="assistant", content=reply_text)
    db.add(assistant)
    db.commit()
    db.refresh(assistant)
    return ChatMessageOut.model_validate(assistant)
