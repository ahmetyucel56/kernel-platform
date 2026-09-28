"""Kalici silme (odev / sinif / kullanici) — tum bagli kayitlarla, dogru sirayla.

Fonksiyonlar commit ETMEZ; cagiran tek bir islemde commit eder. Silinen ham
ZIP'lerin depolama anahtarlari dondurulur (commit'ten sonra best-effort silinir).
"""
from __future__ import annotations

import uuid

from sqlalchemy import delete, or_, select, update
from sqlalchemy.orm import Session

from app.models import (
    AiAnalysis,
    AiChatMessage,
    Assignment,
    AssignmentReopen,
    Class,
    ClassCourse,
    Comment,
    Community,
    CommunityPost,
    CommunityReply,
    Enrollment,
    Notification,
    PlagiarismMatch,
    PostVote,
    Precheck,
    ProgressSnapshot,
    Score,
    SecurityEvent,
    StudentBadge,
    Submission,
    SubmissionFile,
    User,
    UserSession,
)


def _zip_keys(subs) -> list[str]:
    return [s.zip_storage_path for s in subs if s.zip_storage_path and not s.zip_storage_path.startswith("(")]


def purge_submissions(db: Session, sub_ids: list[uuid.UUID]) -> None:
    if not sub_ids:
        return
    analysis_ids = select(AiAnalysis.id).where(AiAnalysis.target_submission_id.in_(sub_ids))
    db.execute(delete(PlagiarismMatch).where(
        PlagiarismMatch.submission_id.in_(sub_ids)
        | PlagiarismMatch.matched_submission_id.in_(sub_ids)
        | PlagiarismMatch.ai_analysis_id.in_(analysis_ids)
    ))
    db.execute(delete(AiAnalysis).where(AiAnalysis.target_submission_id.in_(sub_ids)))
    db.execute(delete(AiChatMessage).where(AiChatMessage.submission_id.in_(sub_ids)))
    db.execute(delete(Comment).where(Comment.submission_id.in_(sub_ids)))
    db.execute(delete(Score).where(Score.submission_id.in_(sub_ids)))
    db.execute(delete(SubmissionFile).where(SubmissionFile.submission_id.in_(sub_ids)))
    db.execute(delete(Notification).where(Notification.submission_id.in_(sub_ids)))
    db.execute(delete(Submission).where(Submission.id.in_(sub_ids)))


def purge_assignment(db: Session, assignment: Assignment) -> list[str]:
    """Odevi ve tum bagli verilerini (gonderimler, dosyalar, yorumlar, puanlar,
    AI analizleri, mentor sohbetleri, uzatmalar, on kontroller) siler."""
    subs = db.scalars(select(Submission).where(Submission.assignment_id == assignment.id)).all()
    purge_submissions(db, [s.id for s in subs])
    db.execute(delete(AssignmentReopen).where(AssignmentReopen.assignment_id == assignment.id))
    db.execute(delete(Precheck).where(Precheck.assignment_id == assignment.id))
    db.execute(delete(Notification).where(Notification.assignment_id == assignment.id))
    db.delete(assignment)
    return _zip_keys(subs)


def purge_communities(db: Session, community_ids: list[uuid.UUID]) -> None:
    if not community_ids:
        return
    post_ids = select(CommunityPost.id).where(CommunityPost.community_id.in_(community_ids))
    db.execute(delete(PostVote).where(PostVote.post_id.in_(post_ids)))
    db.execute(delete(CommunityReply).where(CommunityReply.post_id.in_(post_ids)))
    db.execute(delete(CommunityPost).where(CommunityPost.community_id.in_(community_ids)))
    db.execute(delete(Community).where(Community.id.in_(community_ids)))


def purge_class(db: Session, cls: Class) -> list[str]:
    """Sinifi odevleri, kayitlari, topluluklari ve sinif analizleriyle siler."""
    keys: list[str] = []
    for a in db.scalars(select(Assignment).where(Assignment.class_id == cls.id)).all():
        keys += purge_assignment(db, a)
    purge_communities(db, list(db.scalars(select(Community.id).where(Community.scope_ref_id == cls.id))))
    class_analyses = select(AiAnalysis.id).where(AiAnalysis.target_class_id == cls.id)
    db.execute(delete(PlagiarismMatch).where(PlagiarismMatch.ai_analysis_id.in_(class_analyses)))
    db.execute(delete(AiAnalysis).where(AiAnalysis.target_class_id == cls.id))
    db.execute(delete(ProgressSnapshot).where(ProgressSnapshot.class_id == cls.id))
    db.execute(delete(Enrollment).where(Enrollment.class_id == cls.id))
    db.execute(delete(ClassCourse).where(ClassCourse.class_id == cls.id))
    db.delete(cls)
    return keys


def purge_user(db: Session, user: User, heir: User) -> list[str]:
    """Kullaniciyi ve ona ait her seyi siler.

    - Hocanin siniflari (odevler, teslimler dahil) silinir.
    - Ogrencinin teslimleri, on kontrolleri, mentor sohbetleri, rozetleri silinir.
    - Kendi gonderi/yanit/oylari silinir; actigi GENEL topluluklar baskalarinin
      icerigi kaybolmasin diye silen yoneticiye (heir) devredilir.
    - Baska teslimlere yazdigi yorumlar metinle kalir (yazar bos).
    - Guvenlik kayitlari silinmez (kullanici baglantisi kalkar).
    """
    uid = user.id
    keys: list[str] = []
    for cls in db.scalars(select(Class).where(Class.academician_id == uid)).all():
        keys += purge_class(db, cls)
    db.flush()
    for a in db.scalars(select(Assignment).where(Assignment.created_by == uid)).all():
        keys += purge_assignment(db, a)
    db.flush()
    subs = db.scalars(select(Submission).where(Submission.student_id == uid)).all()
    purge_submissions(db, [s.id for s in subs])
    keys += _zip_keys(subs)

    requested = select(AiAnalysis.id).where(AiAnalysis.requested_by == uid)
    db.execute(delete(PlagiarismMatch).where(PlagiarismMatch.ai_analysis_id.in_(requested)))
    db.execute(delete(AiAnalysis).where(AiAnalysis.requested_by == uid))
    db.execute(delete(AiChatMessage).where(AiChatMessage.student_id == uid))
    db.execute(delete(Score).where(Score.graded_by == uid))
    db.execute(update(Comment).where(Comment.author_id == uid).values(author_id=None))
    db.execute(delete(AssignmentReopen).where(
        or_(AssignmentReopen.student_id == uid, AssignmentReopen.reopened_by == uid)))
    db.execute(delete(Precheck).where(Precheck.student_id == uid))
    db.execute(delete(Enrollment).where(Enrollment.student_id == uid))
    db.execute(delete(StudentBadge).where(StudentBadge.student_id == uid))
    db.execute(delete(ProgressSnapshot).where(ProgressSnapshot.student_id == uid))
    db.execute(delete(Notification).where(Notification.user_id == uid))

    own_posts = select(CommunityPost.id).where(CommunityPost.author_id == uid)
    db.execute(delete(PostVote).where(or_(PostVote.user_id == uid, PostVote.post_id.in_(own_posts))))
    db.execute(delete(CommunityReply).where(
        or_(CommunityReply.author_id == uid, CommunityReply.post_id.in_(own_posts))))
    db.execute(delete(CommunityPost).where(CommunityPost.author_id == uid))
    db.execute(update(Community).where(Community.created_by == uid).values(created_by=heir.id))

    db.execute(delete(UserSession).where(UserSession.user_id == uid))
    db.execute(update(SecurityEvent).where(SecurityEvent.user_id == uid).values(user_id=None))
    db.execute(update(SecurityEvent).where(SecurityEvent.actor_id == uid).values(actor_id=None))
    db.delete(user)
    return keys
