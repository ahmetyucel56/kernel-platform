"""Panolar icin ozet uclari (web ve mobil ayni veriyi kullanir).

- GET /me/teaching-overview   hoca: siniflar + odev ilerlemesi + "ilgilenmen gerekenler"
- GET /assignments/{id}/roster hoca: odevin ogrenci bazli teslim/not/benzerlik tablosu
- GET /classes/{id}/grades     hoca: not cizelgesi (Excel'in "Notlar" sayfasinin ayni)
- GET /me/assignments          ogrenci: tum odevleri, son surum, not ve on kontrol hakki

Yalnizca okuma yapar; AI cagirmaz (benzerlik, daha once calistirilmis intihal
analizinin sonucundan okunur).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, require_roles
from app.models import (
    AiAnalysis,
    Assignment,
    AssignmentReopen,
    Class,
    Enrollment,
    Precheck,
    Score,
    Submission,
    User,
)
from app.lib.classinfo import class_courses, course_names, department_name
from app.routers.insights import _owned_class
from app.routers.submissions import _aware
from app.services import analysis_service as ana

router = APIRouter(tags=["overview"])

SIM_WARN = ana.SIMILARITY_WARN  # tek esik: analiz karari, not onerisi ve Excel ile ayni
SOON = timedelta(days=7)
PRECHECK_WINDOW = timedelta(hours=24)


def _iso(dt: datetime | None) -> str | None:
    return _aware(dt).isoformat() if dt else None


def _class_due(db: Session, a: Assignment, student_id: uuid.UUID | None = None) -> datetime:
    """Tum sinif (ve verilirse ogrenciye ozel) uzatmalar dahil gecerli son tarih."""
    who = AssignmentReopen.student_id.is_(None)
    if student_id is not None:
        who = who | (AssignmentReopen.student_id == student_id)
    until = db.scalar(
        select(func.max(AssignmentReopen.reopened_until))
        .where(AssignmentReopen.assignment_id == a.id, who)
    )
    base = _aware(a.deadline_at)
    return max(base, _aware(until)) if until else base


def _students(db: Session, class_id: uuid.UUID) -> list[User]:
    return list(db.scalars(
        select(User).join(Enrollment, Enrollment.student_id == User.id)
        .where(Enrollment.class_id == class_id).order_by(User.full_name)
    ).all())


def _cells(db: Session, a: Assignment, students: list[User]) -> list[dict]:
    """Ogrenci basina: son surum, surum sayisi, hocanin en son notu, benzerlik, durum."""
    subs = db.scalars(select(Submission).where(Submission.assignment_id == a.id)).all()
    by_student: dict[uuid.UUID, list[Submission]] = {}
    for s in subs:
        by_student.setdefault(s.student_id, []).append(s)
    latest = {sid: max(v, key=lambda x: x.version_number) for sid, v in by_student.items()}

    # Her ogrencinin EN SON verilen notu (hangi surume verilmis olursa olsun)
    last_score: dict[uuid.UUID, tuple[Score, Submission]] = {}
    sub_by_id = {s.id: s for s in subs}
    if subs:
        for sc in db.scalars(
            select(Score).where(Score.submission_id.in_(list(sub_by_id)))
            .order_by(Score.graded_at.desc())
        ):
            owner = sub_by_id[sc.submission_id].student_id
            last_score.setdefault(owner, (sc, sub_by_id[sc.submission_id]))

    # Son surumlerin en son intihal analizi
    plag: dict[uuid.UUID, AiAnalysis] = {}
    if latest:
        for an in db.scalars(
            select(AiAnalysis).where(
                AiAnalysis.analysis_type == ana.PLAGIARISM,
                AiAnalysis.target_submission_id.in_([s.id for s in latest.values()]),
            ).order_by(AiAnalysis.created_at.desc())
        ):
            plag.setdefault(an.target_submission_id, an)

    rows = []
    for st in students:
        sub = latest.get(st.id)
        row = {
            "student": {"id": str(st.id), "full_name": st.full_name, "school_no": st.school_no},
            "latest": None, "versions": len(by_student.get(st.id, [])),
            "score": None, "graded_version": None, "status": "none",
            "similarity": None, "similar_to": None,
        }
        if sub:
            row["latest"] = {"id": str(sub.id), "version_number": sub.version_number,
                             "submitted_at": _iso(sub.submitted_at)}
            got = last_score.get(st.id)
            if got:
                sc, graded = got
                row["score"] = sc.score
                row["graded_version"] = graded.version_number
                # Notlandiktan sonra yeni surum geldiyse yeniden bakilmali
                row["status"] = "graded" if graded.version_number >= sub.version_number else "new_version"
            else:
                row["status"] = "ungraded"
            an = plag.get(sub.id)
            if an is not None:
                top = (an.summary_json or {}).get("top_similarity")
                if isinstance(top, (int, float)):
                    row["similarity"] = top
                    matches = (an.detail_json or {}).get("matches") or []
                    if matches:
                        row["similar_to"] = matches[0].get("student_name")
        rows.append(row)
    return rows


def _needs_review(row: dict) -> bool:
    return row["status"] in ("ungraded", "new_version")


# --- Hoca ------------------------------------------------------------------
@router.get("/me/teaching-overview")
def teaching_overview(
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("academician", "admin")),
) -> dict:
    stmt = select(Class) if user.role == "admin" else select(Class).where(Class.academician_id == user.id)
    classes = db.scalars(stmt.order_by(Class.name)).all()
    now = datetime.now(timezone.utc)

    out_classes, upcoming = [], []
    ungraded, due_soon, similar, missing = [], [], [], []
    for cls in classes:
        courses = class_courses(db, cls.id)
        students = _students(db, cls.id)
        assignments = db.scalars(
            select(Assignment).where(Assignment.class_id == cls.id).order_by(Assignment.deadline_at.desc())
        ).all()
        cnames = course_names(db, [a.course_id for a in assignments])
        a_out = []
        for a in assignments:
            rows = _cells(db, a, students)
            due = _class_due(db, a)
            is_open = due >= now
            submitted = sum(1 for r in rows if r["latest"])
            graded = sum(1 for r in rows if r["status"] == "graded")
            waiting = sum(1 for r in rows if _needs_review(r))
            item = {
                "id": str(a.id), "title": a.title, "deadline_at": _iso(a.deadline_at),
                "course_id": str(a.course_id) if a.course_id else None,
                "course_name": cnames.get(a.course_id),
                "submission_kind": a.submission_kind,
                "effective_deadline_at": due.isoformat(), "open": is_open,
                "enrolled": len(students), "submitted": submitted, "graded": graded,
                "needs_review": waiting,
            }
            a_out.append(item)
            ref = {"class_id": str(cls.id), "class_name": cls.name,
                   "course_name": cnames.get(a.course_id),
                   "assignment_id": str(a.id), "title": a.title}
            if waiting:
                ungraded.append({**ref, "count": waiting})
            if is_open and due - now <= SOON:
                due_soon.append({**ref, "due": due.isoformat()})
            if is_open:
                upcoming.append({**ref, "due": due.isoformat(), "submitted": submitted,
                                 "enrolled": len(students)})
                if len(students) - submitted > 0:
                    missing.append({**ref, "count": len(students) - submitted})
            # Yuksek benzerlik: ayni cift iki kez sayilmasin
            seen: set[frozenset] = set()
            for r in rows:
                sim = r["similarity"]
                if isinstance(sim, (int, float)) and sim >= SIM_WARN and r["latest"]:
                    key = frozenset({r["student"]["full_name"], r["similar_to"] or "?"})
                    if key in seen:
                        continue
                    seen.add(key)
                    similar.append({**ref, "student_name": r["student"]["full_name"],
                                    "other_name": r["similar_to"], "similarity": sim,
                                    "submission_id": r["latest"]["id"]})
        out_classes.append({
            "id": str(cls.id), "name": cls.name, "term": cls.term,
            "department_name": department_name(db, cls),
            "courses": [{"id": str(c.id), "name": c.name, "code": c.code} for c in courses],
            "course_name": courses[0].name if len(courses) == 1 else None,
            "student_count": len(students), "assignment_count": len(assignments),
            "assignments": a_out,
        })

    def block(items: list[dict], key: str | None = None) -> dict:
        total = sum(i[key] for i in items) if key else len(items)
        return {"count": total, "items": items}

    upcoming.sort(key=lambda x: x["due"])
    due_soon.sort(key=lambda x: x["due"])
    similar.sort(key=lambda x: -x["similarity"])
    return {
        "classes": out_classes,
        "attention": {
            "needs_review": block(ungraded, "count"),
            "due_soon": block(due_soon),
            "similarity": block(similar),
            "missing": block(missing, "count"),
        },
        "upcoming": upcoming[:6],
    }


@router.get("/assignments/{assignment_id}/roster")
def assignment_roster(
    assignment_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("academician", "admin")),
) -> dict:
    a = db.get(Assignment, assignment_id)
    if a is None:
        raise HTTPException(status_code=404, detail="Ödev bulunamadı.")
    _owned_class(db, a.class_id, user)
    students = _students(db, a.class_id)
    rows = _cells(db, a, students)
    # Ogrenciye ozel (suresi gecmemis) uzatmalar
    now = datetime.now(timezone.utc)
    personal: dict[str, datetime] = {}
    for sid, until in db.execute(
        select(AssignmentReopen.student_id, AssignmentReopen.reopened_until).where(
            AssignmentReopen.assignment_id == a.id, AssignmentReopen.student_id.is_not(None))
    ):
        u = _aware(until)
        if u > now and (str(sid) not in personal or u > personal[str(sid)]):
            personal[str(sid)] = u
    for r in rows:
        ext = personal.get(r["student"]["id"])
        r["extended_until"] = ext.isoformat() if ext else None
    # Bakilmasi gerekenler ustte: benzerlik, notlanmamis, yeni surum, notlanmis, teslim yok
    order = {"ungraded": 1, "new_version": 1, "graded": 2, "none": 3}
    rows.sort(key=lambda r: (
        0 if (r["similarity"] or 0) >= SIM_WARN else order[r["status"]],
        r["student"]["full_name"],
    ))
    return {
        "enrolled": len(students),
        "submitted": sum(1 for r in rows if r["latest"]),
        "graded": sum(1 for r in rows if r["status"] == "graded"),
        "needs_review": sum(1 for r in rows if _needs_review(r)),
        "similarity_warn": SIM_WARN,
        "rows": rows,
    }


@router.get("/classes/{class_id}/grades")
def class_grades(
    class_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("academician", "admin")),
) -> dict:
    """Not cizelgesi: hocanin verdigi en son not; bos = not verilmemis (0 degil)."""
    cls = _owned_class(db, class_id, user)
    students = sorted(_students(db, cls.id), key=lambda u: (u.school_no or "", u.full_name))
    assignments = db.scalars(
        select(Assignment).where(Assignment.class_id == cls.id).order_by(Assignment.deadline_at)
    ).all()
    cnames = course_names(db, [a.course_id for a in assignments])
    by_assignment = {a.id: {r["student"]["id"]: r for r in _cells(db, a, students)} for a in assignments}
    rows = []
    for st in students:
        cells = [by_assignment[a.id][str(st.id)] for a in assignments]
        scores = [c["score"] for c in cells]
        given = [s for s in scores if s is not None]
        rows.append({
            "student": {"id": str(st.id), "full_name": st.full_name, "school_no": st.school_no},
            "scores": scores,
            "statuses": [c["status"] for c in cells],
            "average": round(sum(given) / len(given), 1) if given else None,
        })
    return {"assignments": [{"id": str(a.id), "title": a.title,
                             "course_id": str(a.course_id) if a.course_id else None,
                             "course_name": cnames.get(a.course_id)} for a in assignments],
            "rows": rows}


# --- Ogrenci ---------------------------------------------------------------
@router.get("/me/assignments")
def my_assignments(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict]:
    """Ogrencinin tum odevleri: gecerli son tarih, son surum, not, on kontrol hakki."""
    if user.role != "student":
        raise HTTPException(status_code=403, detail="Bu liste öğrenciler içindir.")
    classes = db.scalars(
        select(Class).join(Enrollment, Enrollment.class_id == Class.id)
        .where(Enrollment.student_id == user.id)
    ).all()
    now = datetime.now(timezone.utc)
    out = []
    for cls in classes:
        rows_a = db.scalars(select(Assignment).where(Assignment.class_id == cls.id)).all()
        cnames = course_names(db, [a.course_id for a in rows_a])
        for a in rows_a:
            cell = _cells(db, a, [user])[0]
            due = _class_due(db, a, user.id)
            pre = None
            if a.precheck_enabled:
                # SQLite tz'yi dusurur: karsilastirma Python'da (precheck.py ile ayni)
                since = now - PRECHECK_WINDOW
                used = sum(1 for t in db.scalars(
                    select(Precheck.created_at).where(
                        Precheck.assignment_id == a.id, Precheck.student_id == user.id)
                ) if _aware(t) >= since)
                pre = {"limit": a.precheck_limit, "remaining": max(0, a.precheck_limit - used)}
            out.append({
                "id": str(a.id), "class_id": str(cls.id), "class_name": cls.name,
                "course_name": cnames.get(a.course_id), "submission_kind": a.submission_kind,
                "title": a.title, "deadline_at": _iso(a.deadline_at),
                "effective_deadline_at": due.isoformat(), "open": due >= now,
                "latest": cell["latest"], "versions": cell["versions"],
                "score": cell["score"], "status": cell["status"], "precheck": pre,
            })
    # Acik olanlar en yakin tarihten; bitenler en yeniden
    out.sort(key=lambda x: (not x["open"], x["effective_deadline_at"] if x["open"] else ""),)
    closed = [x for x in out if not x["open"]]
    closed.sort(key=lambda x: x["effective_deadline_at"], reverse=True)
    return [x for x in out if x["open"]] + closed
