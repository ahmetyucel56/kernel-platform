"""Odevler arasi gelisim: konu siniflandirma, tekrar eden zayiflik, dusus trendi."""
from datetime import datetime, timedelta, timezone

import pytest

from app.services.analysis_service import requirement_topic

from .conftest import STUDENT_1, STUDENT_2


@pytest.mark.parametrize("req,topic", [
    ("Boş başlık girilirse hata dönmeli (doğrulama)", "Girdi doğrulama"),
    ("Kullanıcı girdisi validasyondan geçmeli", "Girdi doğrulama"),
    ("Veritabanı hatalarında try/except kullanılmalı", "Hata yönetimi"),
    ("README dosyası olmalı", "Dokümantasyon"),
    ("En az 3 birim testi olmalı", "Test"),
    ("Not silme endpoint'i olmalı", "CRUD / endpoint"),
    ("Şifreler hash'lenerek saklanmalı", "Kimlik doğrulama"),
    ("Kod PEP8'e uygun olmalı", "Diğer"),
])
def test_requirement_topic(req, topic):
    assert requirement_topic(req) == topic


GOOD = {
    "main.py": 'from fastapi import HTTPException\n@app.post("/x")\ndef add(t):\n'
               '    if not t:\n        raise HTTPException(400, "bos")\n'
               '@app.delete("/x/{i}")\ndef delete_x(i): ...\n',
    "README.md": "# Proje",
}
BAD = {"main.py": 'print("merhaba")\n'}


@pytest.fixture
def fresh_class(client, aca):
    """Diger testlerin odevlerinden etkilenmeyen, iki ogrencili yeni bir sinif."""
    course = client.get("/courses", headers=aca).json()[0]
    cls = client.post("/classes", headers=aca, json={"course_id": course["id"], "name": "Trend sınıfı"}).json()
    for no in (STUDENT_1, STUDENT_2):
        assert client.post(f"/classes/{cls['id']}/enroll", headers=aca,
                           json={"student_no": no}).status_code == 201
    return cls["id"]


def _assignment(client, aca, cid, title, reqs, days):
    return client.post("/assignments", headers=aca, json={
        "class_id": cid, "title": title, "requirements": reqs,
        "deadline_at": (datetime.now(timezone.utc) + timedelta(days=days)).isoformat(),
    }).json()["id"]


def test_recurring_weakness_and_falling_trend(client, aca, s1, s2, fresh_class, submit):
    cid = fresh_class
    a1 = _assignment(client, aca, cid, "Ödev 1",
                     ["Boş başlık girilirse hata dönmeli (doğrulama)", "README dosyası olmalı",
                      "Silme endpoint'i olmalı"], days=1)
    a2 = _assignment(client, aca, cid, "Ödev 2",
                     ["Geçersiz girdide doğrulama hatası dönmeli", "Silme endpoint'i olmalı"], days=2)

    submit(s1, a1, GOOD)   # Mehmet: iyi -> kotu (dusus)
    submit(s1, a2, BAD)
    submit(s2, a1, BAD)    # Zeynep: iki odevde de dogrulama eksik
    submit(s2, a2, BAD)
    for aid in (a1, a2):
        r = client.post(f"/classes/{cid}/ai-overview/analyze", json={"assignment_id": aid}, headers=aca)
        assert r.status_code == 200

    o = client.get(f"/classes/{cid}/ai-overview", params={"assignment_id": a2}, headers=aca).json()
    mehmet = next(s for s in o["students"] if "Mehmet" in s["full_name"])
    zeynep = next(s for s in o["students"] if "Zeynep" in s["full_name"])

    # Gecmis odev sirasina gore (teslim tarihi)
    assert [p["title"] for p in mehmet["history"]] == ["Ödev 1", "Ödev 2"]
    assert mehmet["history"][0]["coverage"] == 100 and mehmet["history"][1]["coverage"] == 0
    assert mehmet["trend"] == "down"

    topics = {r["topic"]: r for r in zeynep["recurring"]}
    assert topics["Girdi doğrulama"]["count"] == 2
    assert topics["Girdi doğrulama"]["assignments"] == ["Ödev 1", "Ödev 2"]
    assert zeynep["trend"] == "flat"

    cls_topics = {t["topic"]: t["students"] for t in o["recurring_topics"]}
    assert "Zeynep Kaya" in cls_topics["Girdi doğrulama"]
    assert any("kapsam son ödevde düştü" in t and "Mehmet" in t for t in o["insights"])
    assert any("Girdi doğrulama" in t for t in o["insights"])


def test_unanalyzed_assignments_do_not_create_trend(client, aca, s1, fresh_class, submit):
    cid = fresh_class
    a1 = _assignment(client, aca, cid, "Tek", ["Silme olmalı"], days=1)
    submit(s1, a1, BAD)
    o = client.get(f"/classes/{cid}/ai-overview", headers=aca).json()
    me = next(s for s in o["students"] if "Mehmet" in s["full_name"])
    assert me["trend"] is None and me["recurring"] == []
    assert me["history"][0] == {"assignment_id": a1, "title": "Tek", "submitted": True, "coverage": None}
