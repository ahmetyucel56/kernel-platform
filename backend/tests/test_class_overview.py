"""Sinif AI ozeti (pop-it): toplama, toplu analiz, kural degisikligi, geri bildirim."""

REQS = [
    "Not ekleme endpoint'i olmali",
    "Notlari listeleme endpoint'i olmali",
    "Not silme endpoint'i olmali",
    "Not guncelleme endpoint'i olmali",
    "README dosyası olmalı",
]

GOOD = {
    "main.py": '''from fastapi import FastAPI, HTTPException
app = FastAPI()
notes = {}
@app.post("/notes")
def create_note(title: str):
    notes[len(notes)] = title
@app.get("/notes")
def list_notes():
    return notes
@app.delete("/notes/{nid}")
def delete_note(nid: int):
    notes.pop(nid)
@app.put("/notes/{nid}")
def update_note(nid: int, title: str):
    notes[nid] = title
''',
    "README.md": "# Not API\nKurulum: pip install fastapi",
}
BAD = {"main.py": 'from fastapi import FastAPI\napp = FastAPI()\n@app.get("/notes")\ndef list_notes():\n    return []\n'}


def overview(client, aca, class_id, aid):
    r = client.get(f"/classes/{class_id}/ai-overview", params={"assignment_id": aid}, headers=aca)
    assert r.status_code == 200, r.text
    return r.json()


def analyze(client, aca, class_id, aid):
    r = client.post(f"/classes/{class_id}/ai-overview/analyze", json={"assignment_id": aid}, headers=aca)
    assert r.status_code == 200, r.text
    return r.json()


def student(o, name_part):
    return next(s for s in o["students"] if name_part in s["full_name"])


def test_students_cannot_open_overview(client, s1, class_id):
    assert client.get(f"/classes/{class_id}/ai-overview", headers=s1).status_code == 403


def test_no_submissions_yet(client, aca, class_id, make_assignment):
    aid = make_assignment(REQS)
    o = overview(client, aca, class_id, aid)
    assert o["assignment"]["id"] == aid
    assert o["submitted_count"] == 0
    assert o["average_coverage"] is None
    assert all(s["status"] == "no_submission" for s in o["students"])


def test_analyze_aggregates_per_rule_and_student(client, aca, s1, s2, class_id, make_assignment, submit):
    aid = make_assignment(REQS)
    submit(s1, aid, GOOD)
    submit(s2, aid, BAD)

    before = overview(client, aca, class_id, aid)
    assert before["pending_count"] == 2 and before["analyzed_count"] == 0

    o = analyze(client, aca, class_id, aid)
    assert o["newly_analyzed"] == 2
    assert o["analyzed_count"] == 2 and o["pending_count"] == 0

    good, bad = student(o, "Mehmet"), student(o, "Zeynep")
    assert good["coverage"] == 100 and good["status"] == "ok"
    assert bad["coverage"] < 50 and bad["status"] == "at_risk"
    # Riskli ogrenci listede en ustte
    assert o["students"][0]["full_name"] == bad["full_name"]
    # Her kural icin kanitli madde var
    assert {it["requirement"] for it in good["items"]} == set(REQS)
    readme = next(it for it in bad["items"] if "README" in it["requirement"])
    assert readme["status"] == "missing"
    # Kural bazinda sayac: README 1 tam, 1 eksik
    rule = next(r for r in o["requirements"] if "README" in r["requirement"])
    assert (rule["met"], rule["missing"]) == (1, 1)

    # Idempotent: ikinci cagri tekrar analiz etmez (bosa AI maliyeti yok)
    assert analyze(client, aca, class_id, aid)["newly_analyzed"] == 0


def test_new_version_goes_back_to_pending(client, aca, s1, class_id, make_assignment, submit):
    aid = make_assignment(REQS)
    submit(s1, aid, BAD)
    analyze(client, aca, class_id, aid)
    submit(s1, aid, GOOD)  # v2
    o = overview(client, aca, class_id, aid)
    me = student(o, "Mehmet")
    assert me["version"] == 2 and me["status"] == "pending" and not me["analyzed"]
    o = analyze(client, aca, class_id, aid)
    assert student(o, "Mehmet")["coverage"] == 100


def test_rule_change_marks_analysis_stale(client, aca, s1, class_id, make_assignment, submit):
    aid = make_assignment(REQS)
    submit(s1, aid, GOOD)
    analyze(client, aca, class_id, aid)

    r = client.patch(f"/assignments/{aid}", headers=aca,
                     json={"requirements": REQS + ["Birim testleri olmalı"]})
    assert r.status_code == 200, r.text

    o = overview(client, aca, class_id, aid)
    me = student(o, "Mehmet")
    assert me["stale"] and me["status"] == "pending" and not me["analyzed"]
    assert o["stale_count"] == 1
    assert any("Kurallar değişti" in t for t in o["insights"])

    o = analyze(client, aca, class_id, aid)
    me = student(o, "Mehmet")
    assert o["newly_analyzed"] == 1 and not me["stale"] and me["analyzed"]
    assert any("Birim testleri" in it["requirement"] for it in me["items"])


def test_send_feedback_bulk_then_skips_already_sent(client, aca, s1, s2, class_id, make_assignment, submit):
    aid = make_assignment(REQS, title="Geri bildirim ödevi")
    submit(s1, aid, GOOD)
    bad_sub = submit(s2, aid, BAD)
    analyze(client, aca, class_id, aid)

    o = overview(client, aca, class_id, aid)
    assert o["feedback_pending_count"] == 1  # tam puanli ogrenciye gonderilecek eksik yok

    unread_before = client.get("/me/notifications/unread-count", headers=s2).json()["count"]
    r = client.post(f"/classes/{class_id}/ai-overview/send-feedback",
                    json={"assignment_id": aid}, headers=aca)
    assert r.status_code == 200, r.text
    o = r.json()
    assert o["feedback_sent"] == 1 and o["feedback_pending_count"] == 0
    assert student(o, "Zeynep")["feedback_sent_at"]

    # Ogrenci yorumu teslimde gorur ve bildirim alir
    comments = client.get(f"/submissions/{bad_sub['id']}/comments", headers=s2).json()
    body = comments[-1]["body"]
    assert "Eksik:" in body and "README" in body and "yeni sürüm" in body
    assert client.get("/me/notifications/unread-count", headers=s2).json()["count"] == unread_before + 1

    # Toplu gonderim ayni eksikleri ikinci kez gondermez
    r = client.post(f"/classes/{class_id}/ai-overview/send-feedback",
                    json={"assignment_id": aid}, headers=aca)
    assert r.json()["feedback_sent"] == 0


def test_send_feedback_single_requires_fresh_analysis(client, aca, s2, class_id, make_assignment, submit):
    aid = make_assignment(REQS)
    sub = submit(s2, aid, BAD)
    r = client.post(f"/classes/{class_id}/ai-overview/send-feedback",
                    json={"assignment_id": aid, "submission_ids": [sub["id"]]}, headers=aca)
    assert r.status_code == 400  # henuz analiz yok

    analyze(client, aca, class_id, aid)
    r = client.post(f"/classes/{class_id}/ai-overview/send-feedback",
                    json={"assignment_id": aid, "submission_ids": [sub["id"]]}, headers=aca)
    assert r.status_code == 200 and r.json()["feedback_sent"] == 1
