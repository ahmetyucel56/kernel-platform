"""Sinif AI ozeti (pop-it) — akademisyen.

Sinif listesindeki "AI" butonu ve ogrenci satirindaki AI butonu bu uclari kullanir.

- GET  /classes/{id}/ai-overview           -> KAYITLI gereksinim analizlerini toplar
  (AI cagrisi yapmaz; hizli ve ucretsiz). Kural bazinda kac ogrencide tam/kismen/eksik,
  ogrenci bazinda kapsam + madde madde kanit, teslim etmeyenler, riskliler.
- POST /classes/{id}/ai-overview/analyze   -> ogrencilerin EN SON teslimlerinden
  henuz gereksinim analizi olmayanlari AI ile analiz eder (akademisyen tetikler),
  sonra guncel ozeti dondurur.
"""
from __future__ import annotations

import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import require_roles
from app.models import (
    AiAnalysis,
    Assignment,
    Class,
    Comment,
    Enrollment,
    Precheck,
    Score,
    User,
)
from app.routers.submissions import _latest_per_student, _load_files
from app.services import analysis_service as ana
from app.services.notifications import create_notification

router = APIRouter(tags=["insights"])

RISK_COVERAGE = 50  # bu kapsamin altindaki analizli teslimler "riskli"
MAX_BATCH = 40  # tek istekte en fazla bu kadar teslim analiz edilir
WORKERS = 2  # paralel AI cagrisi (oran sinirini zorlamamak icin dusuk)


class AnalyzeClassIn(BaseModel):
    assignment_id: uuid.UUID


def _owned_class(db: Session, class_id: uuid.UUID, user: User) -> Class:
    cls = db.get(Class, class_id)
    if cls is None:
        raise HTTPException(status_code=404, detail="Sınıf bulunamadı.")
    if user.role != "admin" and cls.academician_id != user.id:
        raise HTTPException(status_code=403, detail="Bu sınıf size ait değil.")
    return cls


def _pick_assignment(
    db: Session, cls: Class, assignment_id: uuid.UUID | None
) -> tuple[list[Assignment], Assignment | None]:
    assignments = db.scalars(
        select(Assignment)
        .where(Assignment.class_id == cls.id)
        .order_by(Assignment.created_at.desc())
    ).all()
    if assignment_id is None:
        return list(assignments), (assignments[0] if assignments else None)
    chosen = next((a for a in assignments if a.id == assignment_id), None)
    if chosen is None:
        raise HTTPException(status_code=404, detail="Ödev bu sınıfta bulunamadı.")
    return list(assignments), chosen


def _latest_req_analyses(db: Session, sub_ids: list[uuid.UUID]) -> dict[uuid.UUID, AiAnalysis]:
    """Her teslimin EN SON gereksinim analizi."""
    if not sub_ids:
        return {}
    rows = db.scalars(
        select(AiAnalysis)
        .where(
            AiAnalysis.analysis_type == ana.REQUIREMENT_CHECK,
            AiAnalysis.target_submission_id.in_(sub_ids),
        )
        .order_by(AiAnalysis.created_at.desc())
    ).all()
    out: dict[uuid.UUID, AiAnalysis] = {}
    for r in rows:
        out.setdefault(r.target_submission_id, r)
    return out


def _items_of(detail: dict) -> list[dict]:
    items = []
    for status in ("met", "partial", "missing"):
        for it in detail.get(status, []) or []:
            items.append({
                "requirement": it.get("requirement", ""),
                "status": status,
                "evidence": it.get("evidence") or it.get("note") or "",
                "where": it.get("where", ""),
            })
    return items


TREND_STEP = 10  # iki odev arasi bu kadar puanlik degisim "yukselis/dusus" sayilir


def _history(db: Session, cls: Class, students: list[User]) -> dict[uuid.UUID, dict]:
    """Her ogrencinin sinifin TUM odevlerindeki gereksinim kapsami + tekrar eden zayifliklar.

    Kurallar odevden odeve degistigi icin tekrar, kural metniyle degil KONU ile
    (Girdi dogrulama, Hata yonetimi...) olculur. Yalnizca guncel kurallarla
    yapilmis analizler sayilir.
    """
    assignments = db.scalars(
        select(Assignment).where(Assignment.class_id == cls.id).order_by(Assignment.deadline_at.asc())
    ).all()
    raw = {st.id: {"points": [], "topics": {}} for st in students}
    for a in assignments:
        reqs = list(a.requirements_json or [])
        latest = {s.student_id: s for s in _latest_per_student(db, a.id)}
        analyses = _latest_req_analyses(db, [s.id for s in latest.values()])
        for st in students:
            sub = latest.get(st.id)
            an = analyses.get(sub.id) if sub else None
            fresh = an is not None and bool(reqs) and not ana.requirements_changed(an.detail_json, reqs)
            raw[st.id]["points"].append({
                "assignment_id": str(a.id),
                "title": a.title,
                "submitted": sub is not None,
                "coverage": (an.summary_json or {}).get("coverage") if fresh else None,
            })
            if not fresh:
                continue
            weak = {
                ana.requirement_topic(it.get("requirement", ""))
                for key in ("missing", "partial")
                for it in ((an.detail_json or {}).get(key) or [])
            } - {"Diğer"}
            for topic in weak:
                raw[st.id]["topics"].setdefault(topic, []).append(a.title)

    out: dict[uuid.UUID, dict] = {}
    for sid, h in raw.items():
        covs = [p["coverage"] for p in h["points"] if p["coverage"] is not None]
        trend = None
        if len(covs) >= 2:
            d = covs[-1] - covs[-2]
            trend = "up" if d >= TREND_STEP else "down" if d <= -TREND_STEP else "flat"
        recurring = sorted(
            ({"topic": t, "count": len(v), "of": len(covs), "assignments": v}
             for t, v in h["topics"].items() if len(v) >= 2),
            key=lambda x: (-x["count"], x["topic"]),
        )
        out[sid] = {"history": h["points"], "trend": trend, "recurring": recurring}
    return out


def _overview(db: Session, cls: Class, assignment_id: uuid.UUID | None) -> dict:
    assignments, asg = _pick_assignment(db, cls, assignment_id)
    students = db.scalars(
        select(User)
        .join(Enrollment, Enrollment.student_id == User.id)
        .where(Enrollment.class_id == cls.id)
        .order_by(User.full_name)
    ).all()

    base = {
        "class_id": str(cls.id),
        "class_name": cls.name,
        "assignments": [
            {
                "id": str(a.id),
                "title": a.title,
                "deadline_at": a.deadline_at.isoformat(),
                "requirement_count": len(a.requirements_json or []),
            }
            for a in assignments
        ],
        "enrolled_count": len(students),
    }
    if asg is None:
        return {**base, "assignment": None, "submitted_count": 0, "analyzed_count": 0,
                "pending_count": 0, "average_coverage": None, "at_risk_count": 0,
                "headline": "Bu sınıfta henüz ödev yok.", "insights": [],
                "requirements": [], "students": [], "recurring_topics": [],
                "stale_count": 0, "feedback_pending_count": 0}

    requirements = list(asg.requirements_json or [])
    deadline = asg.deadline_at if asg.deadline_at.tzinfo else asg.deadline_at.replace(tzinfo=timezone.utc)
    deadline_passed = deadline < datetime.now(timezone.utc)

    latest = {s.student_id: s for s in _latest_per_student(db, asg.id)}
    analyses = _latest_req_analyses(db, [s.id for s in latest.values()])
    scores: dict[uuid.UUID, float] = {}
    if latest:
        for sc in db.scalars(
            select(Score)
            .where(Score.submission_id.in_([s.id for s in latest.values()]))
            .order_by(Score.graded_at.asc())
        ).all():
            scores[sc.submission_id] = sc.score  # en son not kazanir

    history = _history(db, cls, list(students))
    prechecks = dict(db.execute(
        select(Precheck.student_id, func.count())
        .where(Precheck.assignment_id == asg.id)
        .group_by(Precheck.student_id)
    ).all())

    # Kural bazinda sayac (orijinal metne gore eslestirilir)
    norm_to_req = {ana._norm_req(r): r for r in requirements}
    req_stats = {r: {"requirement": r, "met": 0, "partial": 0, "missing": 0} for r in requirements}

    rows = []
    coverages = []
    for st in students:
        sub = latest.get(st.id)
        row = {
            "student_id": str(st.id),
            "full_name": st.full_name,
            "school_no": st.school_no,
            "submission_id": str(sub.id) if sub else None,
            "version": sub.version_number if sub else None,
            "submitted_at": sub.submitted_at.isoformat() if sub else None,
            "score": scores.get(sub.id) if sub else None,
            "analyzed": False,
            "coverage": None,
            "met": 0, "partial": 0, "missing": 0,
            "items": [],
            "status": "no_submission" if not sub else "pending",
            "stale": False,
            "analyzed_at": None,
            "feedback_sent_at": None,
            "precheck_count": int(prechecks.get(st.id, 0)),
            **history[st.id],
        }
        an = analyses.get(sub.id) if sub else None
        if an is not None and ana.requirements_changed(an.detail_json, requirements):
            # Analizden sonra kurallar degismis: sonuc guvenilmez, yeniden analiz gerekir
            row["stale"] = True
            an = None
        if an is not None:
            s = an.summary_json or {}
            d = an.detail_json or {}
            row.update({
                "analyzed": True,
                "coverage": s.get("coverage"),
                "met": s.get("met_count", 0),
                "partial": s.get("partial_count", 0),
                "missing": s.get("missing_count", 0),
                "items": _items_of(d),
                "analyzed_at": an.created_at.isoformat(),
                "feedback_sent_at": d.get("feedback_sent_at"),
            })
            cov = s.get("coverage")
            if isinstance(cov, (int, float)):
                coverages.append(cov)
                row["status"] = "at_risk" if cov < RISK_COVERAGE else "ok"
            for it in row["items"]:
                key = norm_to_req.get(ana._norm_req(it["requirement"]))
                if key is not None:
                    req_stats[key][it["status"]] += 1
        if not sub and deadline_passed:
            row["status"] = "late"  # suresi gecti, teslim yok
        rows.append(row)

    # Oncelik sirasi: riskli -> teslim yok (gec) -> bekleyen -> teslim yok -> iyi
    order = {"at_risk": 0, "late": 1, "pending": 2, "no_submission": 3, "ok": 4}
    rows.sort(key=lambda r: (order[r["status"]], r["coverage"] if r["coverage"] is not None else 101))

    submitted = len([r for r in rows if r["submission_id"]])
    analyzed = len([r for r in rows if r["analyzed"]])
    pending = submitted - analyzed
    stale = len([r for r in rows if r["stale"]])
    feedback_pending = len([r for r in rows if _needs_feedback(r)])
    at_risk = len([r for r in rows if r["status"] in ("at_risk", "late")])
    avg = round(sum(coverages) / len(coverages)) if coverages else None

    req_list = sorted(
        req_stats.values(),
        key=lambda x: (-(x["missing"] + 0.5 * x["partial"]), x["requirement"]),
    )

    # Sinif genelinde tekrar eden zayif konular (birden fazla odevde eksik kalan)
    topic_students: dict[str, list[str]] = {}
    for r in rows:
        for rec in r["recurring"]:
            topic_students.setdefault(rec["topic"], []).append(r["full_name"])
    recurring_topics = sorted(
        ({"topic": t, "students": names} for t, names in topic_students.items()),
        key=lambda x: (-len(x["students"]), x["topic"]),
    )

    insights = _insights(len(students), submitted, analyzed, pending, stale, feedback_pending,
                         avg, req_list, rows, deadline_passed)
    insights += _trend_insights(rows, recurring_topics)
    if avg is not None:
        headline = f"Ortalama kapsam %{avg} — {analyzed} analiz, {submitted}/{len(students)} teslim."
    elif submitted:
        headline = f"{submitted}/{len(students)} teslim var; henüz gereksinim analizi yapılmadı."
    else:
        headline = "Bu ödev için henüz teslim yok."

    return {
        **base,
        "assignment": {
            "id": str(asg.id),
            "title": asg.title,
            "deadline_at": asg.deadline_at.isoformat(),
            "deadline_passed": deadline_passed,
            "requirements": requirements,
        },
        "submitted_count": submitted,
        "analyzed_count": analyzed,
        "pending_count": pending,
        "stale_count": stale,
        "feedback_pending_count": feedback_pending,
        "average_coverage": avg,
        "at_risk_count": at_risk,
        "headline": headline,
        "insights": insights,
        "requirements": req_list,
        "students": rows,
        "recurring_topics": recurring_topics,
    }


def _trend_insights(rows: list[dict], recurring_topics: list[dict]) -> list[str]:
    """Odevler arasi gelisimden cikan, akademisyene donuk kisa tespitler."""
    out: list[str] = []
    # Birden cok ogrencide tekrar eden konu -> sinif geneli (derste tekrar edilebilir)
    for t in [t for t in recurring_topics if len(t["students"]) >= 2][:2]:
        out.append(f"“{t['topic']}” {len(t['students'])} öğrencide birden fazla ödevde eksik kaldı — "
                   "derste tekrar ele almak faydalı olabilir.")
    # Tek ogrenciye ozgu tekrarlar -> ogrenci basina tek satir
    solo: dict[str, list[str]] = {}
    for t in recurring_topics:
        if len(t["students"]) == 1:
            solo.setdefault(t["students"][0], []).append(t["topic"])
    for name, topics in list(solo.items())[:2]:
        out.append(f"{name} birden fazla ödevde aynı konularda eksik: {', '.join(topics)}.")
    falling = [r for r in rows if r["trend"] == "down"]
    for r in falling[:2]:
        covs = [p["coverage"] for p in r["history"] if p["coverage"] is not None]
        out.append(f"{r['full_name']}: kapsam son ödevde düştü (%{covs[-2]} → %{covs[-1]}).")
    return out


def _needs_feedback(row: dict) -> bool:
    """Analizli, eksigi/kismi olan ve eksikleri henuz ogrenciye iletilmemis teslim."""
    return bool(row["analyzed"] and (row["missing"] or row["partial"]) and not row["feedback_sent_at"])


def _insights(enrolled, submitted, analyzed, pending, stale, feedback_pending, avg,
              req_list, rows, deadline_passed) -> list[str]:
    """Akademisyen icin kisa, eyleme donuk tespitler (AI'siz, veriden turetilir)."""
    out: list[str] = []
    missing_sub = enrolled - submitted
    if missing_sub > 0:
        out.append(
            f"{missing_sub} öğrenci henüz teslim etmedi"
            + (" (süre doldu)." if deadline_passed else ".")
        )
    if stale > 0:
        out.append(f"Kurallar değişti: {stale} analiz eski kurallarla yapılmış, yeniden analiz edilmeli.")
    if pending - stale > 0:
        out.append(f"{pending - stale} teslim henüz analiz edilmedi — 'Eksikleri analiz et' ile tamamlayabilirsin.")
    if feedback_pending > 0:
        out.append(f"{feedback_pending} öğrencinin eksikleri henüz kendisine iletilmedi.")
    if analyzed:
        worst = [r for r in req_list if r["missing"] + r["partial"] > 0][:2]
        for r in worst:
            parts = []
            if r["missing"]:
                parts.append(f"{r['missing']} öğrencide eksik")
            if r["partial"]:
                parts.append(f"{r['partial']} öğrencide kısmen")
            out.append(f"“{r['requirement']}” — {', '.join(parts)}.")
        full = [r for r in req_list if r["met"] == analyzed and analyzed > 0]
        if full:
            out.append(f"{len(full)} kural analiz edilen herkeste tam karşılanmış.")
        risky = [r for r in rows if r["status"] == "at_risk"]
        if risky:
            names = ", ".join(r["full_name"] for r in risky[:3])
            more = f" +{len(risky) - 3}" if len(risky) > 3 else ""
            out.append(f"Kapsamı %{RISK_COVERAGE}'nin altında: {names}{more}.")
    if avg is not None and avg >= 85 and not pending:
        out.append("Teslim edenler gereksinimleri genel olarak iyi karşılıyor."
                   if submitted < enrolled else "Sınıf genel olarak gereksinimleri iyi karşılıyor.")
    return out


@router.get("/classes/{class_id}/ai-overview")
def class_ai_overview(
    class_id: uuid.UUID,
    assignment_id: uuid.UUID | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("academician", "admin")),
) -> dict:
    cls = _owned_class(db, class_id, user)
    return _overview(db, cls, assignment_id)


@router.post("/classes/{class_id}/ai-overview/analyze")
def analyze_pending(
    class_id: uuid.UUID,
    payload: AnalyzeClassIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("academician", "admin")),
) -> dict:
    """Analizi olmayan en son teslimleri AI ile gereksinim analizinden gecirir."""
    cls = _owned_class(db, class_id, user)
    _, asg = _pick_assignment(db, cls, payload.assignment_id)
    requirements = list(asg.requirements_json or [])
    if not requirements:
        raise HTTPException(status_code=400, detail="Bu ödevde gereksinim tanımlı değil.")

    enrolled = set(db.scalars(select(Enrollment.student_id).where(Enrollment.class_id == cls.id)).all())
    latest = [s for s in _latest_per_student(db, asg.id) if s.student_id in enrolled]
    done = {
        sid for sid, an in _latest_req_analyses(db, [s.id for s in latest]).items()
        if not ana.requirements_changed(an.detail_json, requirements)  # eski kurallarla olan yeniden
    }
    todo = [s for s in latest if s.id not in done][:MAX_BATCH]

    failed: list[uuid.UUID] = []
    if todo:
        jobs = [(s.id, _load_files(db, s.id)) for s in todo]  # DB okumalari ana thread'de

        def run(job):
            try:
                return job[0], ana.requirement_check(job[1], requirements)
            except ana.AIUnavailable:
                return job[0], None  # kaydedilmez; "bekliyor" olarak kalir

        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            results = list(pool.map(run, jobs))
        failed = [sid for sid, res in results if res is None]
        for sub_id, result in results:
            if result is None:
                continue
            db.add(AiAnalysis(
                requested_by=user.id,
                scope="single",
                analysis_type=ana.REQUIREMENT_CHECK,
                target_submission_id=sub_id,
                summary_json=result["summary"],
                detail_json=result["detail"],
            ))
        db.commit()

    out = _overview(db, cls, asg.id)
    out["newly_analyzed"] = len(todo) - len(failed)
    out["failed"] = len(failed)  # AI cevap veremedi; tekrar denenebilir
    return out


class SendFeedbackIn(BaseModel):
    assignment_id: uuid.UUID
    # Bos/None: eksigi olan ve henuz bildirilmemis TUM ogrencilere gonder
    submission_ids: list[uuid.UUID] | None = None


def feedback_body(summary: dict, detail: dict) -> str:
    """Gereksinim analizinden ogrenciye gidecek duzenli geri bildirim metni."""
    lines = ["(Yapay zekanın gereksinim kontrolü; hocan tarafından iletildi.)",
             f"Gereksinim kontrolü: %{summary.get('coverage', 0)} kapsam "
             f"({summary.get('met_count', 0)} tam, {summary.get('partial_count', 0)} kısmen, "
             f"{summary.get('missing_count', 0)} eksik)."]
    for key, title in (("missing", "Eksik"), ("partial", "Kısmen karşılanan")):
        items = detail.get(key) or []
        if not items:
            continue
        lines.append("")
        lines.append(f"{title}:")
        for it in items:
            ev = (it.get("evidence") or it.get("note") or "").strip()
            where = (it.get("where") or "").strip()
            line = f"• {it.get('requirement', '')}"
            if ev:
                line += f" — {ev}"
            if where:
                line += f" ({where})"
            lines.append(line)
    lines.append("")
    lines.append("Bu maddeleri düzeltip yeni sürüm yükleyebilirsin.")
    return "\n".join(lines)


@router.post("/classes/{class_id}/ai-overview/send-feedback")
def send_feedback(
    class_id: uuid.UUID,
    payload: SendFeedbackIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("academician", "admin")),
) -> dict:
    """Eksik/kismi kurallari ogrencinin teslimine yorum olarak ekler + bildirim gonderir.

    Yalnizca guncel kurallarla yapilmis analizler gonderilir; gonderim zamani analize
    yazilir (ayni eksikler iki kez gonderilmesin diye toplu gonderim bunlari atlar).
    """
    cls = _owned_class(db, class_id, user)
    _, asg = _pick_assignment(db, cls, payload.assignment_id)
    requirements = list(asg.requirements_json or [])
    enrolled = set(db.scalars(select(Enrollment.student_id).where(Enrollment.class_id == cls.id)).all())
    latest = {s.id: s for s in _latest_per_student(db, asg.id) if s.student_id in enrolled}
    analyses = _latest_req_analyses(db, list(latest))

    explicit = payload.submission_ids is not None and len(payload.submission_ids) > 0
    targets = [sid for sid in (payload.submission_ids if explicit else latest) if sid in latest]
    if explicit and len(targets) != len(payload.submission_ids):
        raise HTTPException(status_code=404, detail="Teslim bu ödevin güncel teslimleri arasında değil.")

    sent = 0
    now = datetime.now(timezone.utc).isoformat()
    for sid in targets:
        an = analyses.get(sid)
        if an is None or ana.requirements_changed(an.detail_json, requirements):
            if explicit:
                raise HTTPException(status_code=400, detail="Bu teslim güncel kurallarla analiz edilmemiş.")
            continue
        s, d = an.summary_json or {}, dict(an.detail_json or {})
        if not (s.get("missing_count") or s.get("partial_count")):
            continue
        if d.get("feedback_sent_at") and not explicit:
            continue
        sub = latest[sid]
        db.add(Comment(
            submission_id=sid,
            author_id=user.id,
            author_type="academician",
            body=feedback_body(s, d),
        ))
        create_notification(
            db, sub.student_id, "comment",
            f"'{asg.title}' için eksik gereksinimlerin iletildi (%{s.get('coverage', 0)} kapsam).",
            submission_id=sid, assignment_id=asg.id,
        )
        d["feedback_sent_at"] = now
        an.detail_json = d  # JSON kolonu: yeni nesne atanmali ki degisiklik yazilsin
        sent += 1
    db.commit()

    out = _overview(db, cls, asg.id)
    out["feedback_sent"] = sent
    return out
