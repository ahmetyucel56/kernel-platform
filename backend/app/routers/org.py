"""Organizasyon yapisi: bolum / ders / sinif / kayit.

Cok-bolum, cok-ders destegi bastan tanimli (spec Bolum 1 ve 5).
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, require_roles
from app.models import (
    Assignment,
    Class,
    ClassCourse,
    Community,
    CommunityPost,
    CommunityReply,
    Course,
    Department,
    Enrollment,
    PostVote,
    User,
)
from app.schemas import (
    ClassCourseIn,
    ClassIn,
    ClassOut,
    ClassUpdate,
    CourseIn,
    CourseOut,
    DepartmentIn,
    DepartmentOut,
    EnrollIn,
    EnrollmentOut,
    StudentPasswordOut,
    UserOut,
)
from app.lib.classinfo import attach_course, class_out
from app.services import account_security as sec
from app.services import sessions

router = APIRouter(tags=["org"])


# --- Bolumler ---------------------------------------------------------------
@router.post("/departments", response_model=DepartmentOut, status_code=201)
def create_department(
    payload: DepartmentIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("admin", "academician")),
) -> DepartmentOut:
    """Listede olmayan bölümü hoca da ekleyebilir; aynı bölüm (harf farkı gözetmeden) tekrar açılmaz."""
    if user.is_demo:
        raise HTTPException(status_code=403, detail="Demo hesabı bölüm ekleyemez.")
    name = " ".join(payload.name.split())
    existing = next((d for d in db.scalars(select(Department)) if _norm(d.name) == _norm(name)), None)
    if existing:
        return DepartmentOut.model_validate(existing)
    dep = Department(name=name)
    db.add(dep)
    db.commit()
    db.refresh(dep)
    return DepartmentOut.model_validate(dep)


@router.get("/departments", response_model=list[DepartmentOut])
def list_departments(
    db: Session = Depends(get_db), _: User = Depends(get_current_user)
) -> list[DepartmentOut]:
    rows = db.scalars(select(Department).order_by(Department.name)).all()
    return [DepartmentOut.model_validate(r) for r in rows]


# --- Dersler ----------------------------------------------------------------
@router.post("/courses", response_model=CourseOut, status_code=201)
def create_course(
    payload: CourseIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("admin", "academician")),
) -> CourseOut:
    if user.is_demo:
        raise HTTPException(status_code=403, detail="Demo hesabı yeni ders açamaz.")
    if db.get(Department, payload.department_id) is None:
        raise HTTPException(status_code=404, detail="Bolum bulunamadi.")
    course = Course(
        department_id=payload.department_id, name=payload.name, code=payload.code
    )
    db.add(course)
    db.commit()
    db.refresh(course)
    return CourseOut.model_validate(course)


@router.get("/courses", response_model=list[CourseOut])
def list_courses(
    department_id: uuid.UUID | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[CourseOut]:
    stmt = select(Course)
    if department_id is not None:
        stmt = stmt.where(Course.department_id == department_id)
    rows = db.scalars(stmt.order_by(Course.name)).all()
    return [CourseOut.model_validate(r) for r in rows]


# --- Siniflar ---------------------------------------------------------------
@router.post("/classes", response_model=ClassOut, status_code=201)
def create_class(
    payload: ClassIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("academician", "admin")),
) -> ClassOut:
    course_ids = list(dict.fromkeys(payload.course_ids + ([payload.course_id] if payload.course_id else [])))
    courses = [db.get(Course, cid) for cid in course_ids]
    if any(c is None for c in courses):
        raise HTTPException(status_code=404, detail="Ders bulunamadı.")
    department_id = payload.department_id or (courses[0].department_id if courses else None)
    if department_id is None or db.get(Department, department_id) is None:
        raise HTTPException(status_code=400, detail="Bölüm seçin.")
    cls = Class(
        department_id=department_id,
        academician_id=user.id,
        name=payload.name.strip(),
        term=payload.term,
    )
    db.add(cls)
    db.flush()
    for c in courses:
        attach_course(db, cls, c.id)
    # Sinifa ozel bir topluluk otomatik acilir (soru-cevap alani hazir gelsin).
    db.add(Community(name=f"{cls.name} — Sınıf", scope="class",
                     scope_ref_id=cls.id, created_by=user.id))
    db.commit()
    db.refresh(cls)
    return class_out(db, cls)


@router.get("/classes", response_model=list[ClassOut])
def list_classes(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> list[ClassOut]:
    if user.role == "academician":
        stmt = select(Class).where(Class.academician_id == user.id)
    elif user.role == "admin":
        stmt = select(Class)
    else:  # ogrenci: kayitli oldugu siniflar
        stmt = (
            select(Class)
            .join(Enrollment, Enrollment.class_id == Class.id)
            .where(Enrollment.student_id == user.id)
        )
    rows = db.scalars(stmt.order_by(Class.name)).all()
    return [class_out(db, r) for r in rows]


def _owned_class_or_404(db: Session, class_id: uuid.UUID, user: User) -> Class:
    cls = db.get(Class, class_id)
    if cls is None:
        raise HTTPException(status_code=404, detail="Sinif bulunamadi.")
    if user.role != "admin" and cls.academician_id != user.id:
        raise HTTPException(status_code=403, detail="Bu sinif size ait degil.")
    return cls


@router.patch("/classes/{class_id}", response_model=ClassOut)
def update_class(
    class_id: uuid.UUID,
    payload: ClassUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("academician", "admin")),
) -> ClassOut:
    cls = _owned_class_or_404(db, class_id, user)
    if payload.name is not None:
        cls.name = payload.name.strip()
    if payload.term is not None:
        cls.term = payload.term.strip() or None
    db.commit()
    db.refresh(cls)
    return class_out(db, cls)


@router.post("/classes/{class_id}/courses", response_model=ClassOut, status_code=201)
def add_class_course(
    class_id: uuid.UUID,
    payload: ClassCourseIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("academician", "admin")),
) -> ClassOut:
    """Sınıfa ders ekler. Listede yoksa aynı adla sınıfın bölümünde yeni ders açılır."""
    cls = _owned_class_or_404(db, class_id, user)
    if payload.course_id:
        course = db.get(Course, payload.course_id)
        if course is None:
            raise HTTPException(status_code=404, detail="Ders bulunamadı.")
    elif payload.name:
        if cls.department_id is None:
            raise HTTPException(status_code=400, detail="Sınıfın bölümü yok; listeden ders seçin.")
        name = payload.name.strip()
        # Aynı ders iki kez açılmasın (büyük/küçük harf ve I/ı/İ/i farkı gözetmeden)
        course = next((c for c in db.scalars(select(Course).where(Course.department_id == cls.department_id))
                       if _norm(c.name) == _norm(name)), None)
        if course is None:
            if user.is_demo:
                # Herkese açık demo: yeni ders gerçek hocaların listesine düşmesin
                raise HTTPException(status_code=403, detail="Demo hesabı yeni ders açamaz; listedeki bir dersi yazın.")
            course = Course(department_id=cls.department_id, name=name,
                            code=(payload.code or "").strip() or None)
            db.add(course)
            db.flush()
    else:
        raise HTTPException(status_code=400, detail="Ders seçin ya da yeni dersin adını yazın.")
    attach_course(db, cls, course.id)
    db.commit()
    return class_out(db, cls)


def _norm(s: str) -> str:
    return " ".join(s.lower().replace("̇", "").replace("ı", "i").split())


@router.delete("/classes/{class_id}/courses/{course_id}", response_model=ClassOut)
def remove_class_course(
    class_id: uuid.UUID,
    course_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("academician", "admin")),
) -> ClassOut:
    cls = _owned_class_or_404(db, class_id, user)
    if db.scalar(select(Assignment).where(Assignment.class_id == class_id, Assignment.course_id == course_id)):
        raise HTTPException(status_code=400, detail="Bu derste ödev var. Önce ödevleri silin ya da başka derse taşıyın.")
    db.execute(delete(ClassCourse).where(ClassCourse.class_id == class_id, ClassCourse.course_id == course_id))
    db.commit()
    return class_out(db, cls)


@router.delete("/classes/{class_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_class(
    class_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("academician", "admin")),
) -> None:
    """Sinifi siler. Icinde odev varsa once odevlerin silinmesi gerekir (veri kaybini
    engellemek icin) — bu durumda 400 doner. Kayitlar ve sinif topluluklari silinir."""
    cls = _owned_class_or_404(db, class_id, user)
    if db.scalar(select(Assignment).where(Assignment.class_id == class_id)):
        raise HTTPException(
            status_code=400,
            detail="Bu sinifta odev var. Once odevleri silin, sonra sinifi silebilirsiniz.",
        )
    # Sinifa ait topluluklar (+ gonderi/yanitlari) ve kayitlar
    comm_ids = [
        c.id for c in db.scalars(
            select(Community).where(Community.scope_ref_id == class_id)
        ).all()
    ]
    if comm_ids:
        post_ids = [
            p.id for p in db.scalars(
                select(CommunityPost).where(CommunityPost.community_id.in_(comm_ids))
            ).all()
        ]
        if post_ids:
            db.execute(delete(PostVote).where(PostVote.post_id.in_(post_ids)))
            db.execute(delete(CommunityReply).where(CommunityReply.post_id.in_(post_ids)))
            db.execute(delete(CommunityPost).where(CommunityPost.id.in_(post_ids)))
        db.execute(delete(Community).where(Community.id.in_(comm_ids)))
    db.execute(delete(Enrollment).where(Enrollment.class_id == class_id))
    db.execute(delete(ClassCourse).where(ClassCourse.class_id == class_id))
    db.delete(cls)
    db.commit()


@router.delete("/classes/{class_id}/students/{student_id}", status_code=status.HTTP_204_NO_CONTENT)
def unenroll_student(
    class_id: uuid.UUID,
    student_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("academician", "admin")),
) -> None:
    _owned_class_or_404(db, class_id, user)
    enr = db.scalar(
        select(Enrollment).where(
            Enrollment.class_id == class_id, Enrollment.student_id == student_id
        )
    )
    if enr is None:
        raise HTTPException(status_code=404, detail="Ogrenci bu sinifta kayitli degil.")
    db.delete(enr)
    db.commit()


# --- Kayitlar (enrollment) --------------------------------------------------
@router.post("/classes/{class_id}/enroll", response_model=EnrollmentOut, status_code=201)
def enroll_student(
    class_id: uuid.UUID,
    payload: EnrollIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("academician", "admin")),
) -> EnrollmentOut:
    _owned_class_or_404(db, class_id, user)
    student = db.scalar(select(User).where(User.school_no == payload.student_no))
    if student is None:
        raise HTTPException(status_code=404, detail="Bu okul numarasıyla öğrenci bulunamadı.")
    if student.role != "student":
        raise HTTPException(status_code=400, detail="Kullanıcı öğrenci rolünde değil.")
    if user.is_demo and not student.is_demo:
        # "Sifresiz dene" herkese acik: demo hocasi gercek ogrencileri sinifina ekleyemez
        raise HTTPException(status_code=403, detail="Demo sınıfına yalnızca demo öğrenciler eklenebilir.")
    existing = db.scalar(
        select(Enrollment).where(
            Enrollment.class_id == class_id, Enrollment.student_id == student.id
        )
    )
    if existing:
        raise HTTPException(status_code=409, detail="Ogrenci zaten bu sinifa kayitli.")
    enr = Enrollment(class_id=class_id, student_id=student.id)
    db.add(enr)
    db.commit()
    db.refresh(enr)
    return EnrollmentOut.model_validate(enr)


@router.get("/classes/{class_id}/students", response_model=list[UserOut])
def list_class_students(
    class_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("academician", "admin")),
) -> list[UserOut]:
    _owned_class_or_404(db, class_id, user)
    rows = db.scalars(
        select(User)
        .join(Enrollment, Enrollment.student_id == User.id)
        .where(Enrollment.class_id == class_id)
        .order_by(User.full_name)
    ).all()
    return [UserOut.model_validate(r) for r in rows]


@router.post("/classes/{class_id}/students/{student_id}/reset-password", response_model=StudentPasswordOut)
def reset_student_password(
    class_id: uuid.UUID,
    student_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("academician", "admin")),
) -> StudentPasswordOut:
    """Hoca, KENDI sinifindaki ogrencinin sifresini sifirlar (sifresini unutan ogrenci).

    Gecici sifre yalnizca bu yanitta bir kez gosterilir; ogrenci ilk giriste kendi
    sifresini belirlemek zorundadir. Ogrencinin acik oturumlari kapanir ve ogrenciye
    bildirim gider. (OBS baglaninca sifreler okulda yonetilecek; bu gecis donemi icin.)"""
    if user.is_demo:
        # "Sifresiz dene" ile herkes demo hocasi olabilir: sifre sifirlama asla yok
        raise HTTPException(status_code=403, detail="Demo hesabı şifre sıfırlayamaz.")
    _owned_class_or_404(db, class_id, user)
    enrolled = db.scalar(select(Enrollment).where(
        Enrollment.class_id == class_id, Enrollment.student_id == student_id))
    student = db.get(User, student_id)
    if enrolled is None or student is None or student.role != "student":
        raise HTTPException(status_code=404, detail="Öğrenci bu sınıfta kayıtlı değil.")
    if student.is_demo:
        raise HTTPException(status_code=403, detail="Demo öğrencinin şifresi değiştirilemez (herkese açık hesap).")
    password = sec.temp_password()
    sec.set_password(student, password)
    student.must_change_password = True
    sessions.revoke_all(db, student)
    sec.log_event(db, "password_reset", user=student, actor=user, request=request,
                  detail="hoca tarafından (sınıf üzerinden)")
    sec.notify_security(db, student, f"Şifren {user.full_name} tarafından sıfırlandı. Hocanın verdiği geçici "
                                     "şifreyle girip kendi şifreni belirle.")
    db.commit()
    return StudentPasswordOut(student_name=student.full_name, school_no=student.school_no,
                              university=student.university, temp_password=password)
