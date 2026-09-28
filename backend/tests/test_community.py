"""Topluluk: siralama (yeni/populer), duzenleme ve eski DB'ye kolon ekleme."""
import os
import tempfile
import time

from sqlalchemy import create_engine, inspect, text

import app.db as dbmod


def _setup(client, author):
    comm = client.post("/communities", headers=author, json={"name": "Sıralama testi"}).json()
    ids = []
    for title in ("ilk", "ikinci", "üçüncü"):
        time.sleep(0.02)  # Windows saat cozunurlugu (~15 ms): esit zaman damgasi olmasin
        ids.append(client.post(f"/communities/{comm['id']}/posts", headers=author,
                               json={"title": title}).json()["id"])
    return comm["id"], ids


def test_sort_new_and_top(client, s1, s2, aca):
    cid, (p1, p2, p3) = _setup(client, s1)
    new = [p["id"] for p in client.get(f"/communities/{cid}/posts", headers=s1).json()]
    assert new == [p3, p2, p1]

    for h in (s1, s2, aca):
        client.post(f"/posts/{p1}/vote", headers=h)
    client.post(f"/posts/{p2}/vote", headers=s2)
    top = [p["id"] for p in client.get(f"/communities/{cid}/posts",
                                        params={"sort": "top"}, headers=s1).json()]
    assert top == [p1, p2, p3]
    assert client.get(f"/communities/{cid}/posts", params={"sort": "x"}, headers=s1).status_code == 422


def test_only_author_can_edit(client, s1, s2, aca):
    cid, (p1, _, _) = _setup(client, s1)
    r = client.patch(f"/posts/{p1}", headers=s1, json={"title": "ilk (düzeltildi)", "body": "detay"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["title"] == "ilk (düzeltildi)" and body["body"] == "detay" and body["edited_at"]

    # Baska ogrenci de, moderator (akademisyen) de baskasinin sozunu degistiremez
    assert client.patch(f"/posts/{p1}", headers=s2, json={"title": "x"}).status_code == 403
    assert client.patch(f"/posts/{p1}", headers=aca, json={"title": "x"}).status_code == 403

    reply = client.post(f"/posts/{p1}/replies", headers=s2, json={"body": "cevap"}).json()
    assert reply["edited_at"] is None
    r = client.patch(f"/posts/{p1}/replies/{reply['id']}", headers=s2, json={"body": "cevap (güncel)"})
    assert r.status_code == 200 and r.json()["edited_at"]
    assert client.patch(f"/posts/{p1}/replies/{reply['id']}", headers=s1,
                        json={"body": "x"}).status_code == 403


def test_noop_edit_does_not_mark_edited(client, s1):
    cid, (p1, _, _) = _setup(client, s1)
    r = client.patch(f"/posts/{p1}", headers=s1, json={"title": "ilk"})
    assert r.json()["edited_at"] is None


def test_ensure_columns_adds_edited_at_to_old_tables(monkeypatch):
    """Canli DB'de tablolar eski semayla duruyor; redeploy'da kolon eklenmeli."""
    path = os.path.join(tempfile.mkdtemp(), "old.db")
    eng = create_engine("sqlite:///" + path.replace("\\", "/"))
    with eng.begin() as c:
        c.execute(text("CREATE TABLE community_posts (id VARCHAR PRIMARY KEY, title VARCHAR)"))
        c.execute(text("CREATE TABLE community_replies (id VARCHAR PRIMARY KEY, body TEXT)"))
        c.execute(text("INSERT INTO community_posts VALUES ('1', 'eski')"))
    monkeypatch.setattr(dbmod, "engine", eng)
    dbmod.ensure_columns()
    dbmod.ensure_columns()  # idempotent
    insp = inspect(eng)
    for t in ("community_posts", "community_replies"):
        assert "edited_at" in {c["name"] for c in insp.get_columns(t)}
    with eng.connect() as c:
        assert c.execute(text("SELECT title, edited_at FROM community_posts")).one() == ("eski", None)
