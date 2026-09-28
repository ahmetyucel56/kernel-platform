"""Gelistirme icin ornek veri olusturur.

Calistirma (backend/ dizininde):
    python -m app.seed

Olusturulan TANITIM hesaplari (parola hepsinde: parola123, herkese acik):
    hoca@kernel.dev         (academician)
    ogrenci1@kernel.dev     (student)
    ogrenci2@kernel.dev     (student)
"""
from sqlalchemy import select

from app.config import settings
from app.db import SessionLocal, init_db
from app.models import (
    Assignment,
    Class,
    Community,
    Course,
    Department,
    Enrollment,
    User,
)
from app.security import hash_password
from datetime import datetime, timedelta, timezone

PWD = "parola123"


DEMO_UNIVERSITY = "Demo Üniversitesi"


def _get_or_create_user(db, email, full_name, role, department_id=None, school_no=None):
    user = db.scalar(select(User).where(User.email == email))
    if user:
        # mevcut demo hesaplarina okul no/universite ekle (idempotent)
        if school_no and not user.school_no:
            user.school_no = school_no
            user.university = DEMO_UNIVERSITY
        return user
    user = User(
        email=email,
        full_name=full_name,
        role=role,
        department_id=department_id,
        school_no=school_no,
        university=DEMO_UNIVERSITY if school_no else None,
        hashed_password=hash_password(PWD),
        is_demo=True,  # parolasi herkese acik: sifre/2FA degistirilemez, toplu silinebilir
    )
    db.add(user)
    db.flush()
    return user


def run() -> None:
    init_db()
    db = SessionLocal()
    try:
        from app.services.account_security import get_setting

        if get_setting(db, "demo_login") == "0":
            # Kurucu demoyu kapatti / demo verisini sildi: yeniden olusturma.
            print("Seed atlandi: demo kurucu panelinden kapatilmis.")
            return
        dep = db.scalar(select(Department).where(Department.name == "Bilgisayar Programciligi"))
        if not dep:
            dep = Department(name="Bilgisayar Programciligi")
            db.add(dep)
            db.flush()

        # Not: seed YONETICI hesabi acmaz (parolasi repoda yazili olurdu). Yonetici =
        # kurucu, /kurulum sayfasindan iki adimli dogrulamayla bir kez olusturulur.
        hoca = _get_or_create_user(db, "hoca@kernel.dev", "Dr. Ayşe Yılmaz", "academician", dep.id, school_no="9001")
        o1 = _get_or_create_user(db, "ogrenci1@kernel.dev", "Mehmet Demir", "student", dep.id, school_no="2025001")
        o2 = _get_or_create_user(db, "ogrenci2@kernel.dev", "Zeynep Kaya", "student", dep.id, school_no="2025002")

        course = db.scalar(select(Course).where(Course.name == "Web Programlama II"))
        if not course:
            course = Course(department_id=dep.id, name="Web Programlama II", code="WEB202")
            db.add(course)
            db.flush()

        cls = db.scalar(select(Class).where(Class.name == "WEB202 - 2025 Güz"))
        if not cls:
            cls = Class(
                course_id=course.id,
                academician_id=hoca.id,
                name="WEB202 - 2025 Güz",
                term="2025-Güz",
            )
            db.add(cls)
            db.flush()

        for student in (o1, o2):
            exists = db.scalar(
                select(Enrollment).where(
                    Enrollment.class_id == cls.id, Enrollment.student_id == student.id
                )
            )
            if not exists:
                db.add(Enrollment(class_id=cls.id, student_id=student.id))

        exists_asg = db.scalar(select(Assignment).where(Assignment.class_id == cls.id))
        if not exists_asg:
            db.add(
                Assignment(
                    class_id=cls.id,
                    title="Ödev 1: REST API tasarımı",
                    description="Basit bir TODO REST API'si yazın.",
                    requirements_json=[
                        "En az 4 endpoint (CRUD) olmalı",
                        "Girdi doğrulama yapılmalı",
                        "README dosyası bulunmalı",
                    ],
                    deadline_at=datetime.now(timezone.utc) + timedelta(days=14),
                    created_by=hoca.id,
                )
            )

        # Not: Gelisim grafigi gercek analizlerden uretilir; uydurma trend
        # (progress_snapshots) seed edilmez — veri yoksa "yeterli veri yok" gosterilir.

        # Topluluk: genel + sinifa ozel (ilk acilista bos gorunmesin)
        if not db.scalar(select(Community).where(Community.scope == "general")):
            db.add(Community(name="Genel Soru-Cevap", scope="general",
                             scope_ref_id=None, created_by=hoca.id))
        if not db.scalar(select(Community).where(Community.scope_ref_id == cls.id)):
            db.add(Community(name=f"{cls.name} — Sınıf", scope="class",
                             scope_ref_id=cls.id, created_by=hoca.id))

        if settings.seed_demo_class:
            from app.demo_seed import seed_demo

            if seed_demo(db, hoca, course.id, dep.id, _get_or_create_user):
                print("Tanitim sinifi olusturuldu (analizler canlida AI ile calistirilmali).")

        db.commit()
        print("Seed tamamlandi. Demo hesaplar (Universite: Demo Universitesi, parola: parola123):")
        print("  Ogrenci No -> 2025001 (Mehmet Demir) / 2025002 (Zeynep Kaya)")
        print("  Personel No -> 9001 (Dr. Ayse Yilmaz, akademisyen)")
    finally:
        db.close()


if __name__ == "__main__":
    run()
