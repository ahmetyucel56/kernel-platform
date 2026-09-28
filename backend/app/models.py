"""SQLAlchemy modelleri — spec Bolum 5'teki tam sema.

Tum tablolar bastan tanimlanir (cok-bolum/cok-ders destegi ve ileriki sprintler
icin), ancak yalnizca ilgili sprintin endpoint'leri kullanilir.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    false,
    true,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def _uuid() -> uuid.UUID:
    return uuid.uuid4()


def _now() -> datetime:
    return datetime.now(timezone.utc)


# --- Organizasyon yapisi ----------------------------------------------------
class Department(Base):
    __tablename__ = "departments"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200), nullable=False)


class User(Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False, index=True)
    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False)  # student|academician|admin
    department_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("departments.id"), nullable=True
    )
    # Proliz/OBS tarzi giris icin: okul (ogrenci/personel) numarasi + universite.
    # Gercek OBS API'si eve geclince baglanacak; su an demo amacli yerel dogrulama.
    school_no: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    university: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Yalnizca AUTH_PROVIDER=local icin kullanilir; Supabase Auth'ta bos kalir.
    hashed_password: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    # --- Hesap guvenligi (0003) ---
    # Kurucu: sistemin sahibi (tek). Yonetici paneli + tum veriye erisim.
    is_founder: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=false())
    # Tanitim hesabi: sifresi herkese acik; sifre/2FA degistirilemez, toplu silinebilir.
    is_demo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=false())
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=true())
    # JWT'deki "tv" bununla eslesmezse oturum gecersiz (sifre degisimi / tum cihazlardan cikis)
    token_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    must_change_password: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=false())
    failed_logins: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Iki adimli dogrulama (TOTP, dogrulayici uygulama)
    totp_secret: Mapped[str | None] = mapped_column(String(64), nullable=True)
    totp_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=false())
    totp_last_step: Mapped[int | None] = mapped_column(Integer, nullable=True)  # ayni kod iki kez kullanilamaz
    backup_codes: Mapped[list | None] = mapped_column(JSON, nullable=True)  # sha256 ozetleri


class SecurityEvent(Base):
    """Guvenlik kaydi: girisler, hatali denemeler, sifre/2FA degisiklikleri, yonetici islemleri."""
    __tablename__ = "security_events"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id"), nullable=True, index=True)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id"), nullable=True)
    event: Mapped[str] = mapped_column(String(40), nullable=False)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(300), nullable=True)
    detail: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)


class UserSession(Base):
    """Bir cihazdaki oturum. Web'de yenileme anahtari httpOnly cerezde durur (secret_hash
    ile dogrulanir); erisim token'lari 'sid' tasir. Tek tek kapatilabilir ve
    "yeni cihazdan giris" tespiti icin cihaz izi (device_hash) tutulur."""
    __tablename__ = "user_sessions"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False, index=True)
    client: Mapped[str] = mapped_column(String(10), nullable=False)  # web | mobile
    secret_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)  # yalnizca web
    device_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    user_agent: Mapped[str | None] = mapped_column(String(300), nullable=True)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AppSetting(Base):
    """Calisma zamaninda degistirilebilen ayarlar (demo girisi, uretilmis JWT anahtari)."""
    __tablename__ = "app_settings"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)


class Course(Base):
    __tablename__ = "courses"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    department_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("departments.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    code: Mapped[str | None] = mapped_column(String(50), nullable=True)


class Class(Base):
    """Bölüm grubu (ör. "Bilgisayar Programcılığı 1. sınıf"). Öğrenciler bir kez kaydolur;
    hoca sınıfa istediği zaman ders ekler ve ödevi bir ders seçerek verir (ClassCourse)."""
    __tablename__ = "classes"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    department_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("departments.id", name="fk_classes_department_id"), nullable=True
    )
    # Eski model (sınıf = tek ders). Yeni sınıflarda boş; dersler class_courses'ta.
    course_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("courses.id"), nullable=True
    )
    academician_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=False
    )
    term: Mapped[str | None] = mapped_column(String(50), nullable=True)  # ornek: 2025-Guz
    name: Mapped[str] = mapped_column(String(200), nullable=False)


class ClassCourse(Base):
    """Sınıfta verilen dersler (hoca istediği zaman ekler)."""
    __tablename__ = "class_courses"
    __table_args__ = (UniqueConstraint("class_id", "course_id", name="uq_class_course"),)
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    class_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("classes.id"), nullable=False)
    course_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("courses.id"), nullable=False)
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=_now, nullable=True)


class Enrollment(Base):
    __tablename__ = "enrollments"
    __table_args__ = (UniqueConstraint("class_id", "student_id", name="uq_enrollment"),)
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    class_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("classes.id"), nullable=False
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=False
    )


# --- Odev ve teslim (versiyonlu, PR-simulasyonu) ----------------------------
class Assignment(Base):
    __tablename__ = "assignments"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    class_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("classes.id"), nullable=False
    )
    # Ödevin dersi (sınıfın derslerinden biri)
    course_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("courses.id", name="fk_assignments_course_id"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # ["X fonksiyonu olmali", ...] gibi serbest gereksinim listesi
    requirements_json: Mapped[list | None] = mapped_column(JSON, nullable=True)
    deadline_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    # Ogrenci teslim etmeden once kodunu kurallara gore on kontrol ettirebilir mi?
    # (AI yalnizca akademisyen isterse calisir kuralinin, akademisyenin actigi istisnasi.)
    precheck_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    precheck_limit: Mapped[int] = mapped_column(  # ogrenci basina 24 saatte
        Integer, nullable=False, default=3, server_default="3"
    )
    # Hocanin baslattigi AI analizlerinin sonucunu ogrenci gorsun mu? (hocanin karari;
    # kapaliyken sonuc, gelisim grafigi ve bu sonuca dayali rozetler ogrenciye yansimaz)
    show_requirement_to_student: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=true()
    )
    show_clean_code_to_student: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=true()
    )
    # Teslim türü: "code" (kod projesi, her tür dosya) | "document" (rapor/belge:
    # PDF, DOCX, görsel, metin). Belge ödevinde Clean Code yerine belge denetimi yapılır.
    submission_kind: Mapped[str] = mapped_column(String(20), nullable=False, default="code", server_default="code")


class Precheck(Base):
    """Ogrencinin teslim oncesi on kontrolu (teslim olusturmaz; hak sayimi + gecmis)."""
    __tablename__ = "prechecks"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    assignment_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("assignments.id"), nullable=False, index=True
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=False, index=True
    )
    file_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    summary_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    detail_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class AssignmentReopen(Base):
    __tablename__ = "assignment_reopens"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    assignment_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("assignments.id"), nullable=False
    )
    # NULL = tum sinifa acik
    student_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=True
    )
    reopened_until: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    reopened_by: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=False
    )


class Submission(Base):
    __tablename__ = "submissions"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    assignment_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("assignments.id"), nullable=False
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=False
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    zip_storage_path: Mapped[str] = mapped_column(String(500), nullable=False)
    file_tree_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class SubmissionFile(Base):
    """Bir gonderimden cikarilan tek dosya.

    Icerik Postgres'te tutulur -> Render disk'i gecici olsa da kalici. Metin
    dosyalarinin icerigi 'content'te; ikili (binary) dosyalarda content NULL,
    yalnizca metadata saklanir. Dosya agacinin yapisi Submission.file_tree_json'da.
    """
    __tablename__ = "submission_files"
    __table_args__ = (
        UniqueConstraint("submission_id", "path", name="uq_submission_file_path"),
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    submission_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("submissions.id"), nullable=False, index=True
    )
    path: Mapped[str] = mapped_column(String(1000), nullable=False)  # ornek: src/app.py
    content: Mapped[str | None] = mapped_column(Text, nullable=True)  # binary ise NULL
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_binary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # PDF/DOCX'ten çıkarılan metin (yapay zekâ kontrolü ve arama için; dosyanın kendisi depoda)
    extracted_text: Mapped[str | None] = mapped_column(Text, nullable=True)


# --- Inceleme / yorum (akademisyen + AI ayni tabloda, author_type ile) ------
class Comment(Base):
    __tablename__ = "comments"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    submission_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("submissions.id"), nullable=False
    )
    author_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=True
    )
    author_type: Mapped[str] = mapped_column(String(20), nullable=False)  # academician|ai
    file_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    line_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Score(Base):
    __tablename__ = "scores"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    submission_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("submissions.id"), nullable=False
    )
    score: Mapped[float] = mapped_column(Float, nullable=False)
    graded_by: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=False
    )
    graded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


# --- AI analiz motoru (isteğe bagli, akademisyen tetikler) ------------------
class AiAnalysis(Base):
    __tablename__ = "ai_analyses"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    requested_by: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=False
    )
    scope: Mapped[str] = mapped_column(String(20), nullable=False)  # single|class
    # clean_code|plagiarism|requirement_check|readme_draft|class_summary
    analysis_type: Mapped[str] = mapped_column(String(30), nullable=False)
    target_submission_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("submissions.id"), nullable=True
    )
    target_class_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("classes.id"), nullable=True
    )
    summary_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    detail_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class AiChatMessage(Base):
    """Ogrenci-AI mentor sohbeti (spec 7.7, Faz 2). Bir gonderim + ogrenciye bagli."""
    __tablename__ = "ai_chat_messages"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    submission_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("submissions.id"), nullable=False, index=True
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=False
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False)  # user | assistant
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class PlagiarismMatch(Base):
    __tablename__ = "plagiarism_matches"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    ai_analysis_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("ai_analyses.id"), nullable=False
    )
    submission_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("submissions.id"), nullable=False
    )
    matched_submission_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("submissions.id"), nullable=False
    )
    similarity_score: Mapped[float] = mapped_column(Float, nullable=False)
    details_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)


# --- Oyunlastirma -----------------------------------------------------------
class Badge(Base):
    __tablename__ = "badges"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    icon: Mapped[str | None] = mapped_column(String(120), nullable=True)


class StudentBadge(Base):
    __tablename__ = "student_badges"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    student_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=False
    )
    badge_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("badges.id"), nullable=False
    )
    earned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class ProgressSnapshot(Base):
    __tablename__ = "progress_snapshots"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    student_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=False
    )
    class_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("classes.id"), nullable=False
    )
    snapshot_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    clean_code_avg_score: Mapped[float | None] = mapped_column(Float, nullable=True)


# --- Bildirimler ------------------------------------------------------------
class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(30), nullable=False)  # graded|comment|submission
    message: Mapped[str] = mapped_column(Text, nullable=False)
    submission_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    assignment_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    is_read: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


# --- Topluluk (Faz 1'de SADECE sema, arayuz yok) ---------------------------
class Community(Base):
    __tablename__ = "communities"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    scope: Mapped[str] = mapped_column(String(20), nullable=False)  # class|department|general
    scope_ref_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class CommunityPost(Base):
    __tablename__ = "community_posts"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    community_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("communities.id"), nullable=False
    )
    author_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class PostVote(Base):
    """Topluluk gonderisine upvote (begeni). Varlik = kullanici oy vermis."""
    __tablename__ = "post_votes"
    __table_args__ = (UniqueConstraint("post_id", "user_id", name="uq_post_vote"),)
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    post_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("community_posts.id"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class CommunityReply(Base):
    __tablename__ = "community_replies"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    post_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("community_posts.id"), nullable=False
    )
    author_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=False
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
