"""Temel akislar: giris, yetki, teslim/yorum/not, bildirim, topluluk, silme."""


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok" and body["db"] == "sqlite" and body["ai_provider"] == "mock"
    assert body["schema"]  # acilista Alembic ile guncel surume gelindi
    assert "sqlite:" not in str(body)  # baglanti dizesi sizdirilmez


def test_wrong_password_rejected(client):
    r = client.post("/auth/login-school",
                    json={"university": "Demo", "school_no": "9001", "password": "yanlis"})
    assert r.status_code == 401


def test_student_cannot_create_assignment(client, s1, class_id):
    r = client.post("/assignments", headers=s1, json={
        "class_id": class_id, "title": "x", "requirements": [],
        "deadline_at": "2030-01-01T00:00:00Z",
    })
    assert r.status_code == 403


def test_review_flow_notifies_student(client, aca, s1, make_assignment, submit):
    aid = make_assignment(["Ekleme olmalı"])
    sub = submit(s1, aid, {"main.py": "def add(a, b):\n    return a + b\n"})
    before = client.get("/me/notifications/unread-count", headers=s1).json()["count"]

    r = client.post(f"/submissions/{sub['id']}/comments", headers=aca,
                    json={"body": "Güzel", "file_path": "main.py", "line_number": 1})
    assert r.status_code == 201
    r = client.post(f"/submissions/{sub['id']}/score", headers=aca, json={"score": 85})
    assert r.status_code == 201

    assert client.get("/me/notifications/unread-count", headers=s1).json()["count"] == before + 2
    assert client.get(f"/submissions/{sub['id']}/score", headers=s1).json()["score"] == 85
    # Ogrenci baskasinin teslimine yorum/not ekleyemez
    assert client.post(f"/submissions/{sub['id']}/score", headers=s1, json={"score": 100}).status_code == 403

    assert client.post("/me/notifications/read-all", headers=s1).status_code == 200
    assert client.get("/me/notifications/unread-count", headers=s1).json()["count"] == 0


def test_student_sees_own_analyses_but_not_plagiarism(client, aca, s1, s2, make_assignment, submit):
    aid = make_assignment(["Ekleme olmalı"])
    code = {"main.py": "def add(a, b):\n    return a + b\n"}
    sub = submit(s1, aid, code)
    submit(s2, aid, code)
    for t in ("requirement_check", "plagiarism"):
        r = client.post(f"/submissions/{sub['id']}/analyze", headers=aca, json={"analysis_type": t})
        assert r.status_code == 201, r.text
    # Ogrenci AI calistiramaz
    assert client.post(f"/submissions/{sub['id']}/analyze", headers=s1,
                       json={"analysis_type": "clean_code"}).status_code == 403
    types = {a["analysis_type"] for a in client.get(f"/submissions/{sub['id']}/analyses", headers=s1).json()}
    assert types == {"requirement_check"}
    types = {a["analysis_type"] for a in client.get(f"/submissions/{sub['id']}/analyses", headers=aca).json()}
    assert types == {"requirement_check", "plagiarism"}


def test_delete_assignment_cascades(client, aca, s1, make_assignment, submit):
    aid = make_assignment(["Ekleme olmalı"])
    sub = submit(s1, aid, {"main.py": "x = 1\n"})
    client.post(f"/submissions/{sub['id']}/analyze", headers=aca, json={"analysis_type": "clean_code"})
    assert client.delete(f"/assignments/{aid}", headers=aca).status_code == 204
    assert client.get(f"/assignments/{aid}", headers=aca).status_code == 404
    assert client.get(f"/submissions/{sub['id']}", headers=aca).status_code == 404


def test_sqlite_enforces_foreign_keys_like_postgres(client):
    import app.db as dbmod
    from sqlalchemy import text
    with dbmod.engine.connect() as c:
        assert c.execute(text("PRAGMA foreign_keys")).scalar() == 1


def test_delete_class_with_voted_community_posts(client, aca, s1):
    """Regresyon: sinif topluluğundaki oylar silinmedigi icin Postgres'te 500 oluyordu."""
    course = client.get("/courses", headers=aca).json()[0]
    cls = client.post("/classes", headers=aca, json={"course_id": course["id"], "name": "Silinecek sınıf"}).json()
    client.post(f"/classes/{cls['id']}/enroll", headers=aca, json={"student_no": "2025001"})
    comm = next(c for c in client.get("/communities", headers=aca).json() if c["scope_ref_id"] == cls["id"])
    post = client.post(f"/communities/{comm['id']}/posts", headers=s1, json={"title": "Soru"}).json()
    client.post(f"/posts/{post['id']}/replies", headers=aca, json={"body": "Cevap"})
    client.post(f"/posts/{post['id']}/vote", headers=aca)

    assert client.delete(f"/classes/{cls['id']}", headers=aca).status_code == 204
    assert all(c["id"] != comm["id"] for c in client.get("/communities", headers=aca).json())


def test_community_votes_and_moderation(client, aca, s1, s2):
    comm = client.post("/communities", headers=s1, json={"name": "Test topluluğu"}).json()
    post = client.post(f"/communities/{comm['id']}/posts", headers=s1,
                       json={"title": "Soru", "body": "Nasıl?"}).json()

    r = client.post(f"/posts/{post['id']}/vote", headers=s2)
    assert r.json() == {"votes": 1, "voted": True}
    assert client.post(f"/posts/{post['id']}/vote", headers=s2).json() == {"votes": 0, "voted": False}

    reply = client.post(f"/posts/{post['id']}/replies", headers=s2, json={"body": "Şöyle"}).json()
    posts = client.get(f"/communities/{comm['id']}/posts", headers=s1).json()
    assert posts[0]["reply_count"] == 1

    # Baska ogrenci yaniti silemez; akademisyen (moderator) silebilir. Demo hocasi
    # (herkese acik "Sifresiz dene" hesabi) genel toplulukta moderator DEGILDIR.
    assert client.delete(f"/posts/{post['id']}/replies/{reply['id']}", headers=s1).status_code == 403
    assert client.delete(f"/posts/{post['id']}/replies/{reply['id']}", headers=aca).status_code == 403
    from .test_logic_review import _extra_user
    real_teacher = _extra_user("academician")
    assert client.delete(f"/posts/{post['id']}/replies/{reply['id']}", headers=real_teacher).status_code == 204
    # Baska ogrenci toplulugu silemez; sahibi silebilir (gonderilerle birlikte)
    assert client.delete(f"/communities/{comm['id']}", headers=s2).status_code == 403
    assert client.delete(f"/communities/{comm['id']}", headers=s1).status_code == 204
    assert client.get(f"/posts/{post['id']}", headers=s1).status_code == 404
