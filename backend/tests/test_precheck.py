"""Ogrencinin teslim oncesi on kontrolu: izin, hak siniri, teslim olusturmama."""
from .conftest import zip_bytes

REQS = ["Not silme endpoint'i olmalı", "README dosyası olmalı"]
CODE = {"main.py": '@app.delete("/notes/{i}")\ndef delete_note(i): ...\n'}


def precheck(client, headers, aid, files=CODE):
    return client.post(f"/assignments/{aid}/precheck", headers=headers,
                       files={"file": ("p.zip", zip_bytes(files), "application/zip")})


def test_disabled_by_default(client, s1, make_assignment):
    aid = make_assignment(REQS)
    st = client.get(f"/assignments/{aid}/precheck", headers=s1).json()
    assert st["enabled"] is False and st["available"] is False
    r = precheck(client, s1, aid)
    assert r.status_code == 403 and "kapalı" in r.json()["detail"]


def test_precheck_runs_without_creating_submission(client, aca, s1, make_assignment):
    aid = make_assignment(REQS)
    assert client.patch(f"/assignments/{aid}", headers=aca,
                        json={"precheck_enabled": True}).json()["precheck_enabled"] is True
    unread = client.get("/me/notifications/unread-count", headers=aca).json()["count"]

    r = precheck(client, s1, aid)
    assert r.status_code == 200, r.text
    res, st = r.json()["result"], r.json()["status"]
    assert (res["met"], res["missing"]) == (1, 1)
    assert {it["requirement"] for it in res["items"]} == set(REQS)
    assert (st["used"], st["remaining"], st["limit"]) == (1, 2, 3)
    assert len(st["history"]) == 1

    # Teslim olusmadi, akademisyene bildirim gitmedi
    assert client.get(f"/assignments/{aid}/submissions", headers=aca).json() == []
    assert client.get("/me/notifications/unread-count", headers=aca).json()["count"] == unread


def test_daily_limit(client, aca, s2, make_assignment):
    aid = make_assignment(REQS)
    client.patch(f"/assignments/{aid}", headers=aca, json={"precheck_enabled": True, "precheck_limit": 2})
    assert precheck(client, s2, aid).status_code == 200
    assert precheck(client, s2, aid).status_code == 200
    r = precheck(client, s2, aid)
    assert r.status_code == 429 and "hakkın doldu" in r.json()["detail"]
    st = client.get(f"/assignments/{aid}/precheck", headers=s2).json()
    assert st["remaining"] == 0 and st["resets_at"]


def test_only_students_and_only_before_deadline(client, aca, s1, make_assignment):
    aid = make_assignment(REQS)
    client.patch(f"/assignments/{aid}", headers=aca, json={"precheck_enabled": True})
    assert precheck(client, aca, aid).status_code == 403

    past = make_assignment(REQS, days=-1)
    client.patch(f"/assignments/{past}", headers=aca, json={"precheck_enabled": True})
    r = precheck(client, s1, past)
    assert r.status_code == 403 and "süresi" in r.json()["detail"]


def test_academician_sees_precheck_count(client, aca, s1, class_id, make_assignment):
    aid = make_assignment(REQS)
    client.patch(f"/assignments/{aid}", headers=aca, json={"precheck_enabled": True})
    precheck(client, s1, aid)
    precheck(client, s1, aid)
    o = client.get(f"/classes/{class_id}/ai-overview", params={"assignment_id": aid}, headers=aca).json()
    me = next(s for s in o["students"] if "Mehmet" in s["full_name"])
    assert me["precheck_count"] == 2


def test_create_assignment_with_precheck(client, aca, class_id):
    r = client.post("/assignments", headers=aca, json={
        "class_id": class_id, "title": "Ön kontrollü", "requirements": ["A olmalı"],
        "deadline_at": "2030-01-01T00:00:00Z", "precheck_enabled": True, "precheck_limit": 5,
    })
    assert r.status_code == 201
    assert (r.json()["precheck_enabled"], r.json()["precheck_limit"]) == (True, 5)
    assert client.post("/assignments", headers=aca, json={
        "class_id": class_id, "title": "x", "deadline_at": "2030-01-01T00:00:00Z",
        "precheck_limit": 0,
    }).status_code == 422
