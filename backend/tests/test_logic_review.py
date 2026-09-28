"""Mantik incelemesinde bulunan sorunlarin regresyon testleri.

- Topluluk kapsami: sinif toplulugu yalnizca o sinifa; baska hoca moderasyon yapamaz.
- AI mentor gunluk siniri.
- README taslagi ogrenciye gosterilmez.
- Gelisim grafigi: ayni teslimi iki kez analiz etmek sahte nokta uretmez.
- Rozetler teslim sayisini degil ilerlemeyi odullendirir.
"""
import uuid
from datetime import datetime, timedelta, timezone

from app.config import settings
from app.db import SessionLocal
from app.models import User
from app.security import create_access_token, hash_password

from .conftest import STUDENT_1, STUDENT_2


def _extra_user(role: str, demo: bool = False) -> dict:
    """Testte ikinci bir hoca / sinifsiz ogrenci (dogrudan DB'ye)."""
    with SessionLocal() as db:
        u = User(email=f"{uuid.uuid4().hex[:8]}@test.dev", full_name=f"Test {role}", role=role,
                 school_no=uuid.uuid4().hex[:9], hashed_password=hash_password("parola123"), is_demo=demo)
        db.add(u)
        db.commit()
        return {"Authorization": f"Bearer {create_access_token(str(u.id), u.role)}"}


def _new_class(client, aca, name, students=(STUDENT_1,)):
    course = client.get("/courses", headers=aca).json()[0]
    cls = client.post("/classes", headers=aca, json={"course_id": course["id"], "name": name}).json()
    for no in students:
        client.post(f"/classes/{cls['id']}/enroll", headers=aca, json={"student_no": no})
    return cls["id"]


def _class_community(client, headers, class_id):
    return next(c for c in client.get("/communities", headers=headers).json() if c.get("scope_ref_id") == class_id)


def test_class_community_is_private_to_the_class(client, aca, s1, s2):
    cid = _new_class(client, aca, "Kapsam Sınıfı", students=(STUDENT_1,))
    comm = _class_community(client, s1, cid)  # kayitli ogrenci gorur
    post = client.post(f"/communities/{comm['id']}/posts", headers=s1, json={"title": "Soru"}).json()

    # Kayitli olmayan ogrenci: listede yok, dogrudan erisim 404
    assert all(c["id"] != comm["id"] for c in client.get("/communities", headers=s2).json())
    assert client.get(f"/communities/{comm['id']}/posts", headers=s2).status_code == 404
    assert client.post(f"/communities/{comm['id']}/posts", headers=s2, json={"title": "x"}).status_code == 404
    assert client.get(f"/posts/{post['id']}", headers=s2).status_code == 404

    # Baska hoca bu sinifin toplulugunda moderasyon yapamaz (goremez de)
    other = _extra_user("academician")
    assert client.delete(f"/posts/{post['id']}", headers=other).status_code == 404
    # Sinifin hocasi silebilir
    assert client.delete(f"/posts/{post['id']}", headers=aca).status_code == 204

    # Ogrenci sinif toplulugu acamaz
    r = client.post("/communities", headers=s1, json={"name": "Sahte", "scope": "class", "scope_ref_id": cid})
    assert r.status_code == 403


def test_upload_notifications_are_grouped(client, aca, s1, s2, submit):
    cid = _new_class(client, aca, "Bildirim Sınıfı", students=(STUDENT_1, STUDENT_2))
    aid = client.post("/assignments", headers=aca, json={
        "class_id": cid, "title": "Bildirim ödevi", "requirements": ["x"],
        "deadline_at": (datetime.now(timezone.utc) + timedelta(days=2)).isoformat(),
    }).json()["id"]
    mine = lambda: [n for n in client.get("/me/notifications", headers=aca).json()  # noqa: E731
                    if n["assignment_id"] == aid and n["kind"] == "submission"]
    submit(s1, aid, {"main.py": "a = 1\n"})
    submit(s2, aid, {"main.py": "b = 2\n"})
    last = submit(s1, aid, {"main.py": "a = 3\n"})
    rows = mine()
    assert len(rows) == 1 and "3 yeni yükleme" in rows[0]["message"]
    assert rows[0]["submission_id"] == last["id"]  # tiklaninca en son yukleme
    # Okununca bir sonraki yukleme yeni bildirim olur
    client.post(f"/me/notifications/{rows[0]['id']}/read", headers=aca)
    submit(s2, aid, {"main.py": "b = 4\n"})
    assert len([n for n in mine() if not n["is_read"]]) == 1


def test_mentor_daily_limit(client, s1, make_assignment, submit, monkeypatch):
    monkeypatch.setattr(settings, "mentor_daily_limit", 2)
    aid = make_assignment(["A olmalı"], title="Mentor sınırı")
    sub = submit(s1, aid, {"main.py": "x = 1\n"})
    # Onceki testlerden kalan sorular da sayilir: sinir, o sayinin ustune 2 soru
    from app.models import AiChatMessage
    with SessionLocal() as db:
        me = db.query(User).filter(User.school_no == STUDENT_1).one()
        used = db.query(AiChatMessage).filter(AiChatMessage.student_id == me.id,
                                              AiChatMessage.role == "user").count()
    monkeypatch.setattr(settings, "mentor_daily_limit", used + 2)
    for _ in range(2):
        assert client.post(f"/submissions/{sub['id']}/chat", headers=s1, json={"message": "ipucu?"}).status_code == 201
    r = client.post(f"/submissions/{sub['id']}/chat", headers=s1, json={"message": "bir tane daha"})
    assert r.status_code == 429 and "24 saatte" in r.json()["detail"]


def test_readme_draft_removed_and_old_records_hidden_from_student(client, aca, s1, make_assignment, submit):
    aid = make_assignment(["README olmalı"], title="README testi")
    sub = submit(s1, aid, {"main.py": "def f():\n    return 1\n"})
    # Yeni README taslagi istenemez (ogrencinin isini yapiyordu)
    r = client.post(f"/submissions/{sub['id']}/analyze", headers=aca, json={"analysis_type": "readme_draft"})
    assert r.status_code == 400 and "kaldırıldı" in r.json()["detail"]
    # Eski bir README taslagi kaydi varsa ogrenci gormez
    from app.models import AiAnalysis
    aca_id = uuid.UUID(client.get("/auth/me", headers=aca).json()["id"])
    with SessionLocal() as db:
        db.add(AiAnalysis(requested_by=aca_id, scope="single", analysis_type="readme_draft",
                          target_submission_id=uuid.UUID(sub["id"]),
                          summary_json={"headline": "eski"}, detail_json={"markdown": "# x"}))
        db.commit()
    assert client.post(f"/submissions/{sub['id']}/analyze", headers=aca, json={"analysis_type": "clean_code"}).status_code == 201
    student_sees = {a["analysis_type"] for a in client.get(f"/submissions/{sub['id']}/analyses", headers=s1).json()}
    teacher_sees = {a["analysis_type"] for a in client.get(f"/submissions/{sub['id']}/analyses", headers=aca).json()}
    assert "readme_draft" in teacher_sees and "readme_draft" not in student_sees
    assert "clean_code" in student_sees


def test_progress_one_point_per_submission_and_badges(client, aca, make_assignment, submit):
    stu = _extra_user("student", demo=True)  # demo hocanin sinifina yalnizca demo ogrenci eklenir
    me = client.get("/auth/me", headers=stu).json()
    cid = _new_class(client, aca, "Rozet Sınıfı", students=())
    client.post(f"/classes/{cid}/enroll", headers=aca, json={"student_no": me["school_no"]})
    aid = client.post("/assignments", headers=aca, json={
        "class_id": cid, "title": "Rozet ödevi", "requirements": ["x"],
        "deadline_at": (datetime.now(timezone.utc) + timedelta(days=2)).isoformat(),
    }).json()["id"]
    v1 = submit(stu, aid, {"main.py": "def a(x):\n  return x\n"})
    # Ayni teslimi iki kez analiz et -> grafikte tek nokta
    for _ in range(2):
        client.post(f"/submissions/{v1['id']}/analyze", headers=aca, json={"analysis_type": "clean_code"})
    prog = client.get("/me/progress", headers=stu).json()
    assert len(prog["points"]) == 1

    badges = {b["code"]: b for b in client.get("/me/badges", headers=stu).json()}
    assert badges["ilk_pr"]["earned"] and not badges["zamaninda"]["earned"]  # 1 odev < 3
    assert badges["zamaninda"]["value"] == "1"
    # Ayni dosyayi tekrar tekrar yuklemek eski "Aktif Gelistirici" rozetini kazandirirdi; artik yok
    for _ in range(3):
        submit(stu, aid, {"main.py": "def a(x):\n  return x\n"})
    codes = {b["code"] for b in client.get("/me/badges", headers=stu).json()}
    assert "aktif" not in codes and "istikrar" not in codes
