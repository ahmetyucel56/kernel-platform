"""Tanitim sinifi: yapi, kod gecerliligi, intihal hikayesi, idempotentlik."""
import os
import tempfile

import pytest
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.orm import sessionmaker

import app.db as dbmod
from app import demo_seed as d
from app.models import (
    Assignment,
    Class,
    CommunityPost,
    Course,
    Department,
    Enrollment,
    Score,
    Submission,
    SubmissionFile,
    User,
)
from app.seed import _get_or_create_user
from app.services import analysis_service as ana
from app.services.analysis_service import FileBlob


@pytest.fixture
def demo_db():
    path = os.path.join(tempfile.mkdtemp(), "demo.db")
    eng = create_engine("sqlite:///" + path.replace("\\", "/"))

    @event.listens_for(eng, "connect")
    def _fk(dbapi_conn, _):  # Postgres gibi yabanci anahtar denetimi
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    dbmod.migrate(bind=eng)
    db = sessionmaker(bind=eng)()
    dep = Department(name="Bilgisayar")
    db.add(dep)
    db.flush()
    course = Course(department_id=dep.id, name="Web Programlama II")
    db.add(course)
    hoca = _get_or_create_user(db, "hoca@kernel.dev", "Dr. Ayşe Yılmaz", "academician", dep.id, school_no="9001")
    db.flush()
    cls = d.seed_demo(db, hoca, course.id, dep.id, _get_or_create_user)
    db.commit()
    yield db, cls, hoca, course, dep
    db.close()


def _latest_files(db, assignment_title: str) -> dict[str, list[FileBlob]]:
    asg = db.scalar(select(Assignment).where(Assignment.title == assignment_title))
    out = {}
    for sub in db.scalars(select(Submission).where(Submission.assignment_id == asg.id)).all():
        name = db.get(User, sub.student_id).full_name
        prev = out.get(name)
        if prev and prev[0] >= sub.version_number:
            continue
        files = db.scalars(select(SubmissionFile).where(SubmissionFile.submission_id == sub.id)).all()
        out[name] = (sub.version_number, [FileBlob(f.path, f.content) for f in files])
    return {k: v[1] for k, v in out.items()}


def test_structure(demo_db):
    db, cls, *_ = demo_db
    assert cls.name == d.DEMO_CLASS_NAME
    assert db.scalar(select(func.count()).select_from(Enrollment).where(Enrollment.class_id == cls.id)) == 8
    asgs = db.scalars(select(Assignment).where(Assignment.class_id == cls.id)).all()
    assert len(asgs) == 3
    a3 = next(a for a in asgs if a.title.startswith("Ödev 3"))
    assert a3.precheck_enabled
    expected_versions = sum(len(v) for s in d.STUDENTS for v in s.work.values())
    assert db.scalar(select(func.count()).select_from(Submission)) == expected_versions
    assert db.scalar(select(func.count()).select_from(Score)) == len(d.SCORES)
    assert db.scalar(select(func.count()).select_from(CommunityPost)) == len(d.POSTS)


def test_story_is_in_the_code(demo_db):
    db, *_ = demo_db
    a1 = _latest_files(db, "Ödev 1: Not Defteri API")
    a2 = _latest_files(db, "Ödev 2: Kütüphane Takip Sistemi")
    # Burak ikinci odevi teslim etmedi; Elif ucuncuyu teslim etmedi
    assert "Burak Aydın" not in a2
    code = lambda blobs: "\n".join(b.content for b in blobs if b.path.endswith(".py"))
    # Zeynep iki odevde de bos baslik kontrolu yazmamis (tekrar eden zayiflik)
    for blobs in (a1["Zeynep Kaya"], a2["Zeynep Kaya"]):
        assert "400" not in code(blobs) and "min_length" not in code(blobs)
    # Mehmet yazmis
    assert "min_length=1" in code(a2["Mehmet Demir"])
    # Emre ilk odevde README'siz
    assert not any(b.path == "README.md" for b in a1["Emre Şahin"])


def test_full_readme_documents_exactly_what_the_code_does():
    """README gercek uclari anlatmali; kodda olmayani (orn. 404) iddia etmemeli."""
    mehmet_a2 = d.build_project("fastapi_router", d.BOOK, d.A2_FULL, "full")["README.md"]
    assert "POST /books/{id}/borrow?student=<ad>" in mehmet_a2 and "409" in mehmet_a2
    assert "`?q=` ile" in mehmet_a2 and "boş başlık reddedilir" in mehmet_a2
    zeynep_a1 = d.build_project("flask_list", d.NOTE, {"add", "list", "delete", "get404"}, "full")["README.md"]
    assert "DELETE /notes/{id}` — kaydı siler (kayıt yoksa 404)" in zeynep_a1
    assert "reddedilir" not in zeynep_a1  # dogrulama yazmadi, README de iddia etmiyor
    selin_a2 = d.build_project("fastapi_sqlite", d.BOOK, d.A2_FULL, "full")["README.md"]
    assert "PUT /books/{id}/lend" in selin_a2
    emre_a3 = d.build_project("fastapi_class", d.TASK, d.A3_FULL, "full")["README.md"]
    assert "PUT /tasks/{id}/done" in emre_a3 and "## Testler" in emre_a3


def test_generated_python_is_valid(demo_db):
    db, *_ = demo_db
    for f in db.scalars(select(SubmissionFile).where(SubmissionFile.path.like("%.py"))).all():
        compile(f.content, f.path, "exec")


def test_only_the_copy_pair_is_flagged(demo_db):
    db, *_ = demo_db
    for title in (a["title"] for a in d.ASSIGNMENTS.values()):
        latest = _latest_files(db, title)
        names = list(latest)
        for i, n1 in enumerate(names):
            for n2 in names[i + 1:]:
                sim = ana.plagiarism(latest[n1], [{"submission_id": 1, "student_name": n2,
                                                   "files": latest[n2]}])["summary"]["top_similarity"]
                if {n1, n2} == {"Can Öztürk", "Deniz Yıldız"} and title.startswith("Ödev 2"):
                    assert sim >= 80, sim
                else:
                    assert sim < 55, (title, n1, n2, sim)


def test_idempotent(demo_db):
    db, cls, hoca, course, dep = demo_db
    assert d.seed_demo(db, hoca, course.id, dep.id, _get_or_create_user) is None
    assert db.scalar(select(func.count()).select_from(Class)) == 1


def test_refills_emptied_demo_class(demo_db):
    """Odevleri silinmis tanitim sinifi yeniden doldurulur; ogrenci/gonderi cogalmaz."""
    db, cls, hoca, course, dep = demo_db
    for a in db.scalars(select(Assignment).where(Assignment.class_id == cls.id)).all():
        for s in db.scalars(select(Submission).where(Submission.assignment_id == a.id)).all():
            for f in db.scalars(select(SubmissionFile).where(SubmissionFile.submission_id == s.id)).all():
                db.delete(f)
            for sc in db.scalars(select(Score).where(Score.submission_id == s.id)).all():
                db.delete(sc)
            from app.models import Comment
            for cm in db.scalars(select(Comment).where(Comment.submission_id == s.id)).all():
                db.delete(cm)
            db.flush()
            db.delete(s)
        db.flush()
        db.delete(a)
    db.commit()

    again = d.seed_demo(db, hoca, course.id, dep.id, _get_or_create_user)
    db.commit()
    assert again is not None and again.id == cls.id
    assert db.scalar(select(func.count()).select_from(Assignment)) == 3
    assert db.scalar(select(func.count()).select_from(Enrollment)) == 8
    assert db.scalar(select(func.count()).select_from(CommunityPost)) == len(d.POSTS)
