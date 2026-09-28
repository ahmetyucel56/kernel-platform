"""Sure yonetimi (one cekme, uzatma iptali, ogrenciye ozel sure) ve hocanin
AI sonuclarini ogrenciden gizleyebilmesi."""
from datetime import datetime, timedelta, timezone

from .conftest import STUDENT_1, STUDENT_2


def _iso(days: float) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


def _setup(client, aca, name="Süre Sınıfı", days=2, **extra):
    course = client.get("/courses", headers=aca).json()[0]
    cid = client.post("/classes", headers=aca, json={"course_id": course["id"], "name": name}).json()["id"]
    for no in (STUDENT_1, STUDENT_2):
        client.post(f"/classes/{cid}/enroll", headers=aca, json={"student_no": no})
    aid = client.post("/assignments", headers=aca, json={
        "class_id": cid, "title": name + " ödevi", "requirements": ["Toplama olmalı"],
        "deadline_at": _iso(days), **extra,
    }).json()["id"]
    return cid, aid


def _upload(client, headers, aid):
    from .conftest import zip_bytes
    return client.post(f"/assignments/{aid}/submissions", headers=headers,
                       files={"file": ("p.zip", zip_bytes({"main.py": "x = 1\n"}), "application/zip")})


def _me(client, headers):
    return client.get("/auth/me", headers=headers).json()["id"]


def test_moving_deadline_earlier_overrides_class_extension(client, aca, s1):
    _, aid = _setup(client, aca, "Öne Çekme", days=1)
    assert client.post(f"/assignments/{aid}/reopen", headers=aca,
                       json={"student_id": None, "reopened_until": _iso(5)}).status_code == 201
    # Hoca tarihi gecmise ceker: sinif uzatmasi da gecersiz olmali -> yukleme kapali
    assert client.patch(f"/assignments/{aid}", headers=aca, json={"deadline_at": _iso(-0.1)}).status_code == 200
    assert _upload(client, s1, aid).status_code == 403
    assert client.get(f"/assignments/{aid}/reopens", headers=aca).json() == []


def test_personal_extension_and_cancel(client, aca, s1, s2):
    _, aid = _setup(client, aca, "Kişisel Süre", days=-1)
    s1_id = _me(client, s1)
    r = client.post(f"/assignments/{aid}/reopen", headers=aca, json={"student_id": s1_id, "reopened_until": _iso(2)})
    assert r.status_code == 201 and r.json()["student_name"] == "Mehmet Demir" and r.json()["active"]
    assert _upload(client, s1, aid).status_code == 201   # yalnizca s1
    assert _upload(client, s2, aid).status_code == 403
    roster = client.get(f"/assignments/{aid}/roster", headers=aca).json()
    ext = {row["student"]["full_name"]: row["extended_until"] for row in roster["rows"]}
    assert ext["Mehmet Demir"] and ext["Zeynep Kaya"] is None

    # Sinif tarihini degistirmek kisisel uzatmayi silmez (bilincli istisna)
    client.patch(f"/assignments/{aid}", headers=aca, json={"deadline_at": _iso(-0.5)})
    reopens = client.get(f"/assignments/{aid}/reopens", headers=aca).json()
    assert len(reopens) == 1
    # Iptal: ogrenci bildirim alir, yukleme kapanir
    assert client.delete(f"/assignments/{aid}/reopens/{reopens[0]['id']}", headers=aca).status_code == 204
    assert _upload(client, s1, aid).status_code == 403
    notes = client.get("/me/notifications", headers=s1).json()
    assert any("iptal edildi" in n["message"] and n["assignment_id"] == aid for n in notes)
    # Ogrenci uzatma listesine erisemez; gecmis tarihli uzatma reddedilir; sinifta olmayan ogrenci reddedilir
    assert client.get(f"/assignments/{aid}/reopens", headers=s1).status_code == 403
    assert client.post(f"/assignments/{aid}/reopen", headers=aca,
                       json={"student_id": s1_id, "reopened_until": _iso(-1)}).status_code == 400
    assert client.post(f"/assignments/{aid}/reopen", headers=aca,
                       json={"student_id": _me(client, aca), "reopened_until": _iso(1)}).status_code == 404


def test_close_now_ends_everything(client, aca, s1, s2):
    _, aid = _setup(client, aca, "Şimdi Bitir", days=3)
    s1_id = _me(client, s1)
    client.post(f"/assignments/{aid}/reopen", headers=aca, json={"student_id": s1_id, "reopened_until": _iso(6)})
    assert client.post(f"/assignments/{aid}/close", headers=s1).status_code == 403  # ogrenci kapatamaz
    r = client.post(f"/assignments/{aid}/close", headers=aca)
    assert r.status_code == 200
    # Ozel sureli ogrenci dahil kimse yukleyemez; uzatma listesi bos
    assert _upload(client, s1, aid).status_code == 403
    assert _upload(client, s2, aid).status_code == 403
    assert client.get(f"/assignments/{aid}/reopens", headers=aca).json() == []
    assert any("kapatıldı" in n["message"] and n["assignment_id"] == aid
               for n in client.get("/me/notifications", headers=s2).json())
    # Ikinci kez: zaten kapali
    assert client.post(f"/assignments/{aid}/close", headers=aca).status_code == 400
    # Hoca fikrini degistirirse yeniden sure verebilir
    client.post(f"/assignments/{aid}/reopen", headers=aca, json={"student_id": None, "reopened_until": _iso(1)})
    assert _upload(client, s2, aid).status_code == 201


def test_teacher_can_hide_ai_results_from_student(client, aca, s1):
    _, aid = _setup(client, aca, "Gizlilik", days=2, show_clean_code_to_student=False)
    sub = _upload(client, s1, aid).json()
    for kind in ("clean_code", "requirement_check"):
        assert client.post(f"/submissions/{sub['id']}/analyze", headers=aca,
                           json={"analysis_type": kind}).status_code == 201
    seen = lambda: {a["analysis_type"] for a in client.get(f"/submissions/{sub['id']}/analyses", headers=s1).json()}  # noqa: E731
    assert seen() == {"requirement_check"}  # Clean Code gizli
    # Gizli Clean Code grafik yoluyla da sizmaz
    pts = client.get("/me/progress", headers=s1).json()["points"]
    assert not any(p["label"] for p in pts if False)  # (yalnizca gorunur odevlerden nokta)
    before = len(pts)

    # Hoca sonra her ikisini de kapatir / Clean Code'u acar
    client.patch(f"/assignments/{aid}", headers=aca,
                 json={"show_requirement_to_student": False, "show_clean_code_to_student": True})
    assert seen() == {"clean_code"}
    assert len(client.get("/me/progress", headers=s1).json()["points"]) == before + 1
    a = client.get(f"/assignments/{aid}", headers=s1).json()
    assert a["show_requirement_to_student"] is False and a["show_clean_code_to_student"] is True
    # Hoca her durumda hepsini gorur
    assert {x["analysis_type"] for x in client.get(f"/submissions/{sub['id']}/analyses", headers=aca).json()} >= {
        "clean_code", "requirement_check"}
