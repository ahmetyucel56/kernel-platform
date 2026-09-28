"""Ogrenciye ozel ozet: gelisim grafigi, rozetler, panel alt basligi (Sprint 4)."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user
from app.routers.submissions import _aware, student_hidden_types
from app.models import (
    AiAnalysis,
    Assignment,
    Class,
    Course,
    Enrollment,
    Submission,
    User,
)
from app.schemas import BadgeOut, MeSummary, ProgressOut, ProgressPoint

router = APIRouter(prefix="/me", tags=["me"])


def _student_submissions(db: Session, user_id) -> list[Submission]:
    return db.scalars(
        select(Submission).where(Submission.student_id == user_id)
    ).all()


def _visible(db: Session, subs: list[Submission], kind: str) -> list[Submission]:
    """Hocanin bu analiz turunu ogrenciden gizledigi odevlerin teslimleri cikarilir
    (gizli sonuc grafik ya da rozet yoluyla da ogrenciye sizmasin)."""
    cache: dict = {}
    out = []
    for s in subs:
        if s.assignment_id not in cache:
            cache[s.assignment_id] = student_hidden_types(db.get(Assignment, s.assignment_id))
        if kind not in cache[s.assignment_id]:
            out.append(s)
    return out


@router.get("/summary", response_model=MeSummary)
def me_summary(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> MeSummary:
    class_label = None
    if user.role == "student":
        enr = db.scalar(select(Enrollment).where(Enrollment.student_id == user.id))
        if enr:
            cls = db.get(Class, enr.class_id)
            course = db.get(Course, cls.course_id) if cls else None
            class_label = course.name if course else (cls.name if cls else None)
    elif user.role == "academician":
        cls = db.scalar(select(Class).where(Class.academician_id == user.id))
        if cls:
            course = db.get(Course, cls.course_id)
            class_label = course.name if course else cls.name
    return MeSummary(
        full_name=user.full_name,
        role=user.role,  # type: ignore[arg-type]
        university=user.university,
        class_label=class_label,
    )


@router.get("/progress", response_model=ProgressOut)
def me_progress(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> ProgressOut:
    """Donem boyu Clean Code trendi — YALNIZCA gercek AI analizlerinden uretilir.

    (Onceden demo amacli 'progress_snapshots' kullaniliyordu; uydurma trend
    gercek verilerle celisebildigi icin kaldirildi. Veri yoksa dürüst 'yeterli
    veri yok' donulur.)
    """
    points: list[ProgressPoint] = []
    subs = {s.id: s for s in _visible(db, _student_submissions(db, user.id), "clean_code")}
    if subs:
        rows = db.scalars(
            select(AiAnalysis)
            .where(
                AiAnalysis.analysis_type == "clean_code",
                AiAnalysis.target_submission_id.in_(list(subs)),
            )
            .order_by(AiAnalysis.created_at.desc())
        ).all()
        # Her teslim icin TEK nokta (en son analiz): hoca ayni teslimi iki kez
        # analiz ederse grafik sahte bir "gelisim" gostermesin. Siralama teslim zamanina gore.
        latest: dict = {}
        for r in rows:
            latest.setdefault(r.target_submission_id, r)
        for sid, r in sorted(latest.items(), key=lambda kv: subs[kv[0]].submitted_at):
            sc = (r.summary_json or {}).get("score")
            if sc is not None:
                points.append(ProgressPoint(label=subs[sid].submitted_at.strftime("%d.%m"),
                                            score=round(float(sc), 1)))

    if not points:
        return ProgressOut(average=None, current=None, points=[])
    scores = [p.score for p in points]
    return ProgressOut(
        average=round(sum(scores) / len(scores), 1),
        current=points[-1].score,
        points=points,
    )


# Rozetler OGRENMEYI odullendirir (teslim sayisini degil): ayni dosyayi tekrar
# yuklemek ya da farkli gunlerde tiklamak rozet kazandirmaz.
def _latest_analysis(db: Session, sub_ids: list, kind: str) -> dict:
    if not sub_ids:
        return {}
    out: dict = {}
    for r in db.scalars(
        select(AiAnalysis)
        .where(AiAnalysis.analysis_type == kind, AiAnalysis.target_submission_id.in_(sub_ids))
        .order_by(AiAnalysis.created_at.desc())
    ):
        out.setdefault(r.target_submission_id, r.summary_json or {})
    return out


@router.get("/badges", response_model=list[BadgeOut])
def me_badges(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> list[BadgeOut]:
    subs = _student_submissions(db, user.id)
    clean_ids = [s.id for s in _visible(db, subs, "clean_code")]
    req_ids = [s.id for s in _visible(db, subs, "requirement_check")]
    clean = {k: v.get("score") for k, v in _latest_analysis(db, clean_ids, "clean_code").items()}
    cover = {k: v.get("coverage") for k, v in _latest_analysis(db, req_ids, "requirement_check").items()}

    # Zamaninda: son tarihten once (uzatma degil) en az bir surum yuklenen odev sayisi
    on_time = set()
    by_asg: dict = {}
    for s in subs:
        by_asg.setdefault(s.assignment_id, []).append(s)
        a = db.get(Assignment, s.assignment_id)
        if a is not None and _aware(s.submitted_at) <= _aware(a.deadline_at):
            on_time.add(s.assignment_id)

    # Gelisen kod: ayni odevde sonraki bir surumun Clean Code skoru oncekinden yuksek
    improved = False
    for versions in by_asg.values():
        scored = [(v.version_number, clean.get(v.id)) for v in versions if isinstance(clean.get(v.id), (int, float))]
        scored.sort()
        if any(b[1] > a[1] for a, b in zip(scored, scored[1:])):
            improved = True
            break

    max_clean = max([c for c in clean.values() if isinstance(c, (int, float))], default=0)
    full = any(isinstance(c, (int, float)) and c >= 100 for c in cover.values())
    n_on_time = len(on_time)
    return [
        BadgeOut(code="ilk_pr", name="İlk Teslim", icon="check",
                 description="İlk projeni yükledin.", earned=len(subs) >= 1),
        BadgeOut(code="zamaninda", name="Zamanında", icon="calendar",
                 description="3 ödevi süresi dolmadan teslim et.", earned=n_on_time >= 3,
                 value=str(n_on_time) if n_on_time else None),
        BadgeOut(code="gelisen", name="Gelişen Kod", icon="count",
                 description="Geri bildirimden sonra yeni sürümle Clean Code puanını yükselt.",
                 earned=improved),
        BadgeOut(code="tam_kapsam", name="Tam Kapsam", icon="star",
                 description="Bir ödevde hocanın tüm kurallarını karşıla (%100).", earned=full),
        BadgeOut(code="temiz_kod", name="Temiz Kod", icon="trophy",
                 description="80+ Clean Code puanı al.", earned=max_clean >= 80),
    ]
