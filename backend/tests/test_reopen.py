"""Teslim uzatma (reopen) arayuze dogru yansir; odev detayi yalnizca yetkiliye acik."""
from datetime import datetime, timedelta, timezone


def _eff(client, headers, class_id, aid):
    rows = client.get(f"/assignments?class_id={class_id}", headers=headers).json()
    row = next(r for r in rows if r["id"] == aid)
    return datetime.fromisoformat(row["effective_deadline_at"].replace("Z", "+00:00"))


def test_reopen_reflected_in_effective_deadline(client, aca, s1, s2, class_id, make_assignment, submit):
    aid = make_assignment(["A olmalı"], title="Süresi geçmiş ödev", days=-1)
    now = datetime.now(timezone.utc)
    assert _eff(client, s1, class_id, aid) < now
    # Uzatma yokken iki alan ayni an (saat dilimi dahil) — sahte "uzatildi" yok
    row = client.get(f"/assignments/{aid}", headers=s1).json()
    assert row["deadline_at"] == row["effective_deadline_at"]
    r = client.post(f"/assignments/{aid}/submissions", headers=s1,
                    files={"file": ("p.zip", b"PK\x05\x06" + b"\0" * 18, "application/zip")})
    assert r.status_code == 403  # sure doldu

    # Yalnizca s1'e uzatma: s1 acik gorur, s2 ve hoca kapali gorur
    s1_id = client.get("/auth/me", headers=s1).json()["id"]
    until = (now + timedelta(days=2)).isoformat()
    assert client.post(f"/assignments/{aid}/reopen", headers=aca,
                       json={"student_id": s1_id, "reopened_until": until}).status_code == 201
    assert _eff(client, s1, class_id, aid) > now
    assert _eff(client, s2, class_id, aid) < now
    assert _eff(client, aca, class_id, aid) < now
    submit(s1, aid, {"main.py": "x = 1\n"})  # arayuz aciyor, sunucu da kabul ediyor

    # Tum sinifa uzatma: herkes acik gorur; tekil GET de ayni alani dondurur
    assert client.post(f"/assignments/{aid}/reopen", headers=aca,
                       json={"student_id": None, "reopened_until": until}).status_code == 201
    assert _eff(client, s2, class_id, aid) > now
    assert _eff(client, aca, class_id, aid) > now
    one = client.get(f"/assignments/{aid}", headers=s2).json()
    assert one["effective_deadline_at"] and one["deadline_at"] != one["effective_deadline_at"]


def test_assignment_detail_requires_access(client, aca, s1, make_assignment):
    course = client.get("/courses", headers=aca).json()[0]
    other = client.post("/classes", headers=aca,
                        json={"course_id": course["id"], "name": "Başka Sınıf"}).json()
    r = client.post("/assignments", headers=aca, json={
        "class_id": other["id"], "title": "Gizli ödev", "requirements": [],
        "deadline_at": (datetime.now(timezone.utc) + timedelta(days=3)).isoformat(),
    })
    aid = r.json()["id"]
    assert client.get(f"/assignments/{aid}", headers=s1).status_code == 403  # kayitli degil
    assert client.get(f"/assignments/{aid}", headers=aca).status_code == 200
