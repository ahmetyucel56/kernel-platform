"""Teslim ZIP sarti olmadan: tek dosya, coklu dosya, klasor (goreli yol) yuklenebilir."""
from datetime import datetime, timedelta, timezone

from .conftest import zip_bytes


def _assignment(client, aca, class_id):
    return client.post("/assignments", headers=aca, json={
        "class_id": class_id, "title": "Dosya yükleme", "requirements": ["Toplama olmalı"],
        "deadline_at": (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()}).json()["id"]


def _paths(client, headers, sub_id):
    out = []

    def walk(node):
        for ch in (node.get("children") or {}).values():
            out.append(ch["path"]) if ch["type"] == "file" else walk(ch)

    walk(client.get(f"/submissions/{sub_id}", headers=headers).json()["file_tree_json"])
    return sorted(out)


def test_single_file_and_multiple_files_and_folder(client, aca, s1, class_id):
    aid = _assignment(client, aca, class_id)
    # Tek .py dosyasi
    r = client.post(f"/assignments/{aid}/submissions", headers=s1,
                    files={"files": ("main.py", b"def topla(a, b):\n    return a + b\n", "text/x-python")})
    assert r.status_code == 201, r.text
    assert _paths(client, s1, r.json()["id"]) == ["main.py"]
    # Klasor: tarayici goreli yollari gonderir; ayni adli iki dosya korunur
    r = client.post(f"/assignments/{aid}/submissions", headers=s1, files=[
        ("files", ("proje/app.py", b"x = 1\n", "text/plain")),
        ("files", ("proje/README.md", b"# Proje\n", "text/plain")),
        ("files", ("proje/src/util.py", b"y = 2\n", "text/plain")),
    ])
    assert r.status_code == 201, r.text
    assert r.json()["version_number"] == 2
    assert _paths(client, s1, r.json()["id"]) == ["proje/README.md", "proje/app.py", "proje/src/util.py"]
    # ZIP eskisi gibi calisir (eski istemciler: alan adi "file")
    r = client.post(f"/assignments/{aid}/submissions", headers=s1,
                    files={"file": ("p.zip", zip_bytes({"a.py": "z = 3\n"}), "application/zip")})
    assert r.status_code == 201, r.text


def test_rejects_unsafe_paths_empty_and_oversize(client, s1, aca, class_id, monkeypatch):
    aid = _assignment(client, aca, class_id)
    r = client.post(f"/assignments/{aid}/submissions", headers=s1,
                    files={"files": ("../../etc/passwd", b"x", "text/plain")})
    assert r.status_code == 400
    r = client.post(f"/assignments/{aid}/submissions", headers=s1, files={"files": ("bos.py", b"", "text/plain")})
    assert r.status_code == 400
    assert client.post(f"/assignments/{aid}/submissions", headers=s1).status_code == 400  # dosya yok
    from app.config import settings
    monkeypatch.setattr(settings, "max_zip_bytes", 1000)
    r = client.post(f"/assignments/{aid}/submissions", headers=s1, files=[
        ("files", ("a.py", b"a" * 600, "text/plain")), ("files", ("b.py", b"b" * 600, "text/plain"))])
    assert r.status_code == 400 and "MB" in r.json()["detail"]
