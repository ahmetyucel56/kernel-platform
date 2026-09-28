"""Pydantic API semalari (istek/yanit modelleri)."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field

Role = Literal["student", "academician", "admin"]


# --- Auth -------------------------------------------------------------------
class LoginIn(BaseModel):
    email: EmailStr
    password: str
    remember: bool = True


# Proliz/OBS tarzi giris (universite + okul no + sifre). Demo: yerel dogrulama.
class SchoolLoginIn(BaseModel):
    university: str = Field(min_length=1, max_length=200)
    school_no: str = Field(min_length=1, max_length=50)
    password: str
    remember: bool = True


class TokenOut(BaseModel):
    """Basarili giris: access_token + user. Iki adimli dogrulama aciksa once
    mfa_required=true + mfa_token doner; kod /auth/login/2fa ile gonderilir."""
    access_token: Optional[str] = None
    token_type: str = "bearer"
    user: Optional["UserOut"] = None
    mfa_required: bool = False
    mfa_token: Optional[str] = None


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    email: EmailStr
    full_name: str
    role: Role
    department_id: Optional[uuid.UUID] = None
    school_no: Optional[str] = None
    university: Optional[str] = None
    created_at: datetime
    is_founder: bool = False
    is_demo: bool = False
    must_change_password: bool = False
    totp_enabled: bool = False


# --- Hesap guvenligi ---------------------------------------------------------
class MfaLoginIn(BaseModel):
    mfa_token: str
    code: str = Field(min_length=6, max_length=20)
    remember: bool = True


class SessionOut(BaseModel):
    id: uuid.UUID
    client: str
    device: str
    ip: Optional[str] = None
    created_at: datetime
    last_seen_at: datetime
    current: bool = False


class ChangePasswordIn(BaseModel):
    current_password: str = Field(max_length=200)
    new_password: str = Field(max_length=200)


class PasswordIn(BaseModel):
    password: str = Field(max_length=200)


class CodeIn(BaseModel):
    code: str = Field(min_length=6, max_length=20)


class TwoFactorDisableIn(BaseModel):
    password: str = Field(max_length=200)
    code: str = Field(min_length=6, max_length=20)


class TwoFactorSetupOut(BaseModel):
    secret: str
    otpauth_uri: str
    qr: str  # PNG data URI


class BackupCodesOut(BaseModel):
    backup_codes: list[str]


class SecurityEventOut(BaseModel):
    id: uuid.UUID
    event: str
    ip: Optional[str] = None
    user_agent: Optional[str] = None
    detail: Optional[str] = None
    created_at: datetime
    user_id: Optional[uuid.UUID] = None
    user_name: Optional[str] = None
    actor_name: Optional[str] = None


class SecurityOut(BaseModel):
    totp_enabled: bool
    backup_codes_left: int
    is_demo: bool
    events: list[SecurityEventOut]


class FounderStatusOut(BaseModel):
    available: bool
    # no_token | short_token | closed | provider (kapaliysa neden)
    reason: Optional[str] = None


class FounderStartIn(BaseModel):
    setup_token: str = Field(max_length=500)
    full_name: str = Field(min_length=2, max_length=200)
    email: EmailStr
    password: str = Field(max_length=200)


class FounderStartOut(TwoFactorSetupOut):
    setup_id: str


class FounderFinishIn(BaseModel):
    setup_id: str
    code: str = Field(min_length=6, max_length=20)


# --- Kurucu paneli -------------------------------------------------------------
class AdminUserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    full_name: str
    email: str
    role: Role
    school_no: Optional[str] = None
    university: Optional[str] = None
    is_founder: bool
    is_demo: bool
    is_active: bool
    totp_enabled: bool
    must_change_password: bool
    locked: bool = False
    last_login_at: Optional[datetime] = None
    created_at: datetime


class AdminUserCreate(BaseModel):
    full_name: str = Field(min_length=2, max_length=200)
    role: Literal["student", "academician"]
    school_no: str = Field(min_length=1, max_length=50)
    university: str = Field(default="Demo Üniversitesi", min_length=1, max_length=200)
    email: Optional[EmailStr] = None
    is_demo: bool = False


class AdminUserPatch(BaseModel):
    full_name: Optional[str] = Field(default=None, min_length=2, max_length=200)
    role: Optional[Literal["student", "academician"]] = None
    is_active: Optional[bool] = None


class TempPasswordOut(BaseModel):
    user: AdminUserOut
    temp_password: str


class StudentPasswordOut(BaseModel):
    student_name: str
    school_no: Optional[str] = None
    university: Optional[str] = None
    temp_password: str


class AdminStatsOut(BaseModel):
    users: dict[str, int]
    demo_users: int
    inactive_users: int
    locked_users: int
    classes: int
    assignments: int
    submissions: int
    analyses_7d: int
    communities: int
    failed_logins_24h: int


class AdminSettingsOut(BaseModel):
    demo_login: bool
    jwt_secret_from_env: bool
    founder_setup_open: bool


class AdminSettingsIn(BaseModel):
    demo_login: bool


# --- Organizasyon -----------------------------------------------------------
class DepartmentIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class DepartmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str


class CourseIn(BaseModel):
    department_id: uuid.UUID
    name: str = Field(min_length=1, max_length=200)
    code: Optional[str] = None


class CourseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    department_id: uuid.UUID
    name: str
    code: Optional[str] = None


class ClassIn(BaseModel):
    """Sınıf = bölüm grubu. Dersler sonradan da eklenebilir (course_ids boş olabilir).
    course_id: eski istemciler için (sınıf = tek ders); bölüm o dersten alınır."""
    department_id: Optional[uuid.UUID] = None
    course_ids: list[uuid.UUID] = Field(default_factory=list)
    course_id: Optional[uuid.UUID] = None
    name: str = Field(min_length=1, max_length=200)
    term: Optional[str] = None


class ClassUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    term: Optional[str] = None


class ClassCourseIn(BaseModel):
    """Sınıfa ders ekle: var olan ders (course_id) ya da yeni ders (name, code)."""
    course_id: Optional[uuid.UUID] = None
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    code: Optional[str] = Field(default=None, max_length=50)


class ClassOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    department_id: Optional[uuid.UUID] = None
    department_name: Optional[str] = None
    course_id: Optional[uuid.UUID] = None
    academician_id: uuid.UUID
    name: str
    term: Optional[str] = None
    courses: list[CourseOut] = Field(default_factory=list)


class EnrollIn(BaseModel):
    # Proliz tarzi: akademisyen ogrenciyi okul numarasi ile ekler.
    student_no: str = Field(min_length=1, max_length=50)


class EnrollmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    class_id: uuid.UUID
    student_id: uuid.UUID


# --- Odev -------------------------------------------------------------------
class AssignmentIn(BaseModel):
    class_id: uuid.UUID
    title: str = Field(min_length=1, max_length=300)
    description: Optional[str] = None
    requirements: list[str] = Field(default_factory=list)
    deadline_at: datetime
    precheck_enabled: bool = False
    precheck_limit: int = Field(default=3, ge=1, le=20)
    show_requirement_to_student: bool = True
    show_clean_code_to_student: bool = True
    submission_kind: Literal["code", "document"] = "code"
    # Sınıfın derslerinden biri. Sınıfın tek dersi varsa boş bırakılabilir.
    course_id: Optional[uuid.UUID] = None


class AssignmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    class_id: uuid.UUID
    title: str
    description: Optional[str] = None
    requirements_json: Optional[list] = None
    deadline_at: datetime
    created_by: uuid.UUID
    created_at: datetime
    precheck_enabled: bool = False
    precheck_limit: int = 3
    show_requirement_to_student: bool = True
    show_clean_code_to_student: bool = True
    submission_kind: str = "code"
    course_id: Optional[uuid.UUID] = None
    course_name: Optional[str] = None
    # Uzatmalar dahil gecerli son tarih (ogrenci: kendine ozel + tum sinif;
    # hoca: tum sinif). "Acik mi?" karari buna gore verilir.
    effective_deadline_at: Optional[datetime] = None


class AssignmentUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=300)
    description: Optional[str] = None
    requirements: Optional[list[str]] = None
    deadline_at: Optional[datetime] = None
    precheck_enabled: Optional[bool] = None
    precheck_limit: Optional[int] = Field(default=None, ge=1, le=20)
    show_requirement_to_student: Optional[bool] = None
    show_clean_code_to_student: Optional[bool] = None
    submission_kind: Optional[Literal["code", "document"]] = None
    course_id: Optional[uuid.UUID] = None


class ReopenIn(BaseModel):
    student_id: Optional[uuid.UUID] = None  # None = tum sinif
    reopened_until: datetime


class ParseRequirementsIn(BaseModel):
    text: str = Field(min_length=1, max_length=8000)


class ParseRequirementsOut(BaseModel):
    requirements: list[str]


class ReopenOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    assignment_id: uuid.UUID
    student_id: Optional[uuid.UUID] = None
    reopened_until: datetime
    reopened_by: uuid.UUID
    student_name: Optional[str] = None  # None = tum sinif
    active: bool = True  # suresi gecmemis mi


# --- Gonderim (submission) --------------------------------------------------
class SubmissionListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    assignment_id: uuid.UUID
    student_id: uuid.UUID
    version_number: int
    submitted_at: datetime


class SubmissionOut(SubmissionListItem):
    file_tree_json: Optional[dict] = None
    # Ekran basligi icin (yalnizca tekil GET doldurur)
    student_name: Optional[str] = None
    assignment_title: Optional[str] = None


class FileContentOut(BaseModel):
    path: str
    content: Optional[str] = None
    is_binary: bool
    size_bytes: int
    preview: str = "none"          # image | pdf | docx | none (ikili dosyalar için)
    has_text: bool = False         # belgeden metin çıkarılabildi mi (yapay zekâ okuyabilir)


class PreviewOut(BaseModel):
    kind: str                      # image | pdf | docx | none
    url: Optional[str] = None      # image
    width: Optional[int] = None
    height: Optional[int] = None
    pages: list[dict] = []         # pdf: [{url, width, height}]
    page_count: int = 0
    truncated: bool = False
    blocks: list[dict] = []        # docx
    reason: Optional[str] = None


class DiffLine(BaseModel):
    type: Literal["ctx", "add", "del"]  # baglam / eklendi / silindi
    a: Optional[int] = None  # eski dosyadaki satir no
    b: Optional[int] = None  # yeni dosyadaki satir no
    text: str


class DiffOut(BaseModel):
    path: str
    from_version: Optional[int] = None
    to_version: int
    changed: bool
    lines: list[DiffLine]


# --- Inceleme: yorum + puan (Sprint 2) --------------------------------------
class CommentIn(BaseModel):
    body: str = Field(min_length=1, max_length=5000)
    file_path: Optional[str] = None
    line_number: Optional[int] = None


class CommentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    submission_id: uuid.UUID
    author_id: Optional[uuid.UUID] = None
    author_type: str  # academician | ai
    author_name: Optional[str] = None
    file_path: Optional[str] = None
    line_number: Optional[int] = None
    body: str
    created_at: datetime


class ScoreIn(BaseModel):
    score: float = Field(ge=0, le=100)


class ScoreOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    submission_id: uuid.UUID
    score: float
    graded_by: uuid.UUID
    grader_name: Optional[str] = None
    graded_at: datetime


# --- AI analiz (Sprint 3) ---------------------------------------------------
AnalysisType = Literal["clean_code", "requirement_check", "plagiarism", "readme_draft"]


class AnalyzeIn(BaseModel):
    analysis_type: AnalysisType


# --- Ogrenci-AI mentor sohbeti (Faz 2) --------------------------------------
class ChatMessageIn(BaseModel):
    message: str = Field(min_length=1, max_length=2000)


class ChatMessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    role: str  # user | assistant
    content: str
    created_at: datetime


class AnalysisOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    analysis_type: str
    scope: str
    target_submission_id: Optional[uuid.UUID] = None
    summary_json: Optional[dict] = None
    detail_json: Optional[dict] = None
    created_at: datetime


# --- Gamification / gelisim (Sprint 4) --------------------------------------
class ProgressPoint(BaseModel):
    label: str
    score: float


class ProgressOut(BaseModel):
    average: Optional[float] = None
    current: Optional[float] = None
    points: list[ProgressPoint]


class BadgeOut(BaseModel):
    code: str
    name: str
    description: str
    icon: Optional[str] = None
    earned: bool
    value: Optional[str] = None  # rozette gosterilecek kisa deger (or. "5")


class MeSummary(BaseModel):
    full_name: str
    role: Role
    university: Optional[str] = None
    class_label: Optional[str] = None  # "Ders adi" veya sinif adi (alt baslik)


# --- Bildirimler ------------------------------------------------------------
class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    kind: str
    message: str
    submission_id: Optional[uuid.UUID] = None
    assignment_id: Optional[uuid.UUID] = None
    is_read: bool
    created_at: datetime


class UnreadCount(BaseModel):
    count: int


# --- Topluluk (Sprint 5: yalnizca veri modeli + API, arayuz yok) -------------
CommunityScope = Literal["class", "department", "general"]


class CommunityIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    scope: CommunityScope = "general"
    scope_ref_id: Optional[uuid.UUID] = None


class CommunityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    scope: str
    scope_ref_id: Optional[uuid.UUID] = None
    created_by: uuid.UUID
    created_at: datetime
    post_count: Optional[int] = None


class PostIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    body: Optional[str] = None


class PostOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    community_id: uuid.UUID
    author_id: uuid.UUID
    author_name: Optional[str] = None
    title: str
    body: Optional[str] = None
    created_at: datetime
    edited_at: Optional[datetime] = None
    reply_count: Optional[int] = None
    vote_count: Optional[int] = None
    i_voted: Optional[bool] = None


class PostEditIn(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=300)
    body: Optional[str] = None


class VoteOut(BaseModel):
    votes: int
    voted: bool


class ReplyIn(BaseModel):
    body: str = Field(min_length=1, max_length=5000)


class ReplyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    post_id: uuid.UUID
    author_id: uuid.UUID
    author_name: Optional[str] = None
    body: str
    created_at: datetime
    edited_at: Optional[datetime] = None


TokenOut.model_rebuild()
