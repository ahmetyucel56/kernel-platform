"""Pano ozetleri: hoca "ilgilenmen gerekenler", odev teslim tablosu, not cizelgesi,
ogrencinin odev listesi."""
from datetime import datetime, timedelta, timezone

import pytest

from .conftest import STUDENT_1, STUDENT_2

CODE = "def topla(a, b):\n    return a + b\n\nprint(topla(2, 3))\n"


@pytest.fixture
def ov(client, aca, s1, s2, submit):
    course = client.get("/courses", headers=aca).json()[0]
    cls = client.post("/classes", headers=aca, json={"course_id": course["id"], "name": "Özet Sınıfı"}).json()
    for no in (STUDENT_1, STUDENT_2):
        client.post(f"/classes/{cls['id']}/enroll", headers=aca, json={"student_no": no})
    aid = client.post("/assignments", headers=aca, json={
        "class_id": cls["id"], "title": "Özet ödevi", "requirements": ["Toplama yapılmalı"],
        "deadline_at": (datetime.now(timezone.utc) + timedelta(days=3)).isoformat(),
        "precheck_enabled": True, "precheck_limit": 2,
    }).json()["id"]
    a1 = submit(s1, aid, {"main.py": CODE})
    client.post(f"/submissions/{a1['id']}/score", headers=aca, json={"score": 80})
    submit(s1, aid, {"main.py": CODE + "# v2\n"})  # notlandiktan sonra yeni surum
    b1 = submit(s2, aid, {"main.py": CODE})         # birebir kopya
    r = client.post(f"/submissions/{b1['id']}/analyze", headers=aca, json={"analysis_type": "plagiarism"})
    assert r.status_code == 201, r.text
    return {"class_id": cls["id"], "aid": aid, "b1": b1["id"]}


def test_roster(client, aca, s1, ov):
    r = client.get(f"/assignments/{ov['aid']}/roster", headers=aca)
    assert r.status_code == 200, r.text
    d = r.json()
    assert (d["enrolled"], d["submitted"], d["graded"], d["needs_review"]) == (2, 2, 0, 2)
    first, second = d["rows"]
    # Yuksek benzerlik en ustte
    assert first["student"]["full_name"] == "Zeynep Kaya"
    assert first["similarity"] >= 70 and first["similar_to"] == "Mehmet Demir"
    assert first["status"] == "ungraded"
    assert second["status"] == "new_version" and second["score"] == 80
    assert second["graded_version"] == 1 and second["latest"]["version_number"] == 2
    assert client.get(f"/assignments/{ov['aid']}/roster", headers=s1).status_code == 403


def test_teaching_overview(client, aca, s1, ov):
    d = client.get("/me/teaching-overview", headers=aca).json()
    cls = next(c for c in d["classes"] if c["id"] == ov["class_id"])
    assert cls["student_count"] == 2 and cls["assignment_count"] == 1
    a = cls["assignments"][0]
    assert (a["enrolled"], a["submitted"], a["graded"], a["needs_review"], a["open"]) == (2, 2, 0, 2, True)
    att = d["attention"]
    mine = lambda block: [i for i in att[block]["items"] if i["class_id"] == ov["class_id"]]  # noqa: E731
    assert mine("needs_review")[0]["count"] == 2
    assert len(mine("due_soon")) == 1
    pair = mine("similarity")
    assert len(pair) == 1 and pair[0]["similarity"] >= 70  # cift bir kez sayilir
    assert mine("missing") == []  # ikisi de teslim etti
    # Yaklasanlar: en fazla 6, en yakin tarih once
    dues = [u["due"] for u in d["upcoming"]]
    assert len(dues) <= 6 and dues == sorted(dues)
    assert client.get("/me/teaching-overview", headers=s1).status_code == 403


def test_class_grades(client, aca, ov):
    d = client.get(f"/classes/{ov['class_id']}/grades", headers=aca).json()
    assert [a["title"] for a in d["assignments"]] == ["Özet ödevi"]
    by_no = {r["student"]["school_no"]: r for r in d["rows"]}
    assert by_no[STUDENT_1]["scores"] == [80] and by_no[STUDENT_1]["average"] == 80
    assert by_no[STUDENT_2]["scores"] == [None] and by_no[STUDENT_2]["average"] is None


def test_my_assignments(client, aca, s1, ov):
    rows = client.get("/me/assignments", headers=s1).json()
    mine = next(r for r in rows if r["id"] == ov["aid"])
    assert mine["open"] and mine["latest"]["version_number"] == 2 and mine["versions"] == 2
    assert mine["score"] == 80 and mine["status"] == "new_version"
    assert mine["precheck"] == {"limit": 2, "remaining": 2}
    assert client.get("/me/assignments", headers=aca).status_code == 403


def test_submission_header_fields(client, aca, ov):
    d = client.get(f"/submissions/{ov['b1']}", headers=aca).json()
    assert d["student_name"] == "Zeynep Kaya" and d["assignment_title"] == "Özet ödevi"
