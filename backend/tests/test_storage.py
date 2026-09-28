"""Proje indirme (orijinal ZIP / yeniden paketleme), indirme token'i guvenligi, Supabase Storage."""
import io
import json
import os
import zipfile

import httpx
import pytest

from app.config import settings
from app.services import storage_service
from app.services.storage_service import SupabaseStorageProvider

from .conftest import zip_bytes

PNG = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"  # null byte -> ikili dosya
FILES = {"main.py": "print('merhaba')\n", "logo.png": PNG}


def _zip_with_binary() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for p, c in FILES.items():
            z.writestr(p, c)
    return buf.getvalue()


def _upload(client, headers, aid) -> tuple[dict, bytes]:
    data = _zip_with_binary()
    r = client.post(f"/assignments/{aid}/submissions", headers=headers,
                    files={"file": ("proje.zip", data, "application/zip")})
    assert r.status_code == 201, r.text
    return r.json(), data


def _download(client, headers, sub_id):
    link = client.post(f"/submissions/{sub_id}/download-link", headers=headers)
    assert link.status_code == 200, link.text
    return client.get(link.json()["url"])


def test_download_returns_original_zip(client, aca, s1, make_assignment):
    aid = make_assignment(["A olmalı"], title="İndirme Ödevi")
    sub, original = _upload(client, s1, aid)
    for who in (aca, s1):  # hoca da ogrenci de (kendi teslimi) indirebilir
        r = _download(client, who, sub["id"])
        assert r.status_code == 200
        assert r.content == original
        assert r.headers["x-kernel-source"] == "original"
        assert 'filename="2025001_Indirme-Odevi_v1.zip"' in r.headers["content-disposition"]


def test_download_token_is_not_a_login_token(client, aca, s1, s2, make_assignment):
    aid = make_assignment(["A olmalı"])
    sub, _ = _upload(client, s1, aid)
    url = client.post(f"/submissions/{sub['id']}/download-link", headers=aca).json()["url"]
    token = url.split("token=")[1]
    # Indirme token'i API'de oturum acamaz
    assert client.get("/classes", headers={"Authorization": f"Bearer {token}"}).status_code == 401
    # Oturum token'i indirme token'i yerine gecmez
    session = aca["Authorization"].split(" ")[1]
    assert client.get(f"/submissions/{sub['id']}/download?token={session}").status_code == 401
    # Baska ogrenci link alamaz
    assert client.post(f"/submissions/{sub['id']}/download-link", headers=s2).status_code == 403


def test_token_is_bound_to_one_submission(client, s1, make_assignment):
    aid = make_assignment(["A olmalı"])
    a, _ = _upload(client, s1, aid)
    b, _ = _upload(client, s1, aid)
    url_a = client.post(f"/submissions/{a['id']}/download-link", headers=s1).json()["url"]
    token_a = url_a.split("token=")[1]
    assert client.get(f"/submissions/{b['id']}/download?token={token_a}").status_code == 401


def test_rebuilds_zip_when_original_is_gone(client, s1, make_assignment):
    aid = make_assignment(["A olmalı"])
    sub, _ = _upload(client, s1, aid)
    stored = os.path.join(settings.storage_dir, "submissions", sub["id"], "original.zip")
    os.remove(stored)  # Render'in gecici diski silinmis gibi

    r = _download(client, s1, sub["id"])
    assert r.status_code == 200 and r.headers["x-kernel-source"] == "rebuilt"
    z = zipfile.ZipFile(io.BytesIO(r.content))
    assert z.read("main.py").decode() == FILES["main.py"]
    assert "logo.png" in z.read("KERNEL_NOT.txt").decode()
    assert "logo.png" not in z.namelist()


def test_deleting_assignment_removes_stored_zips(client, aca, s1, make_assignment):
    aid = make_assignment(["A olmalı"])
    sub, _ = _upload(client, s1, aid)
    stored = os.path.join(settings.storage_dir, "submissions", sub["id"], "original.zip")
    assert os.path.exists(stored)
    assert client.delete(f"/assignments/{aid}", headers=aca).status_code == 204
    assert not os.path.exists(stored)


# --- Supabase Storage (sahte HTTP ile) ---------------------------------------
@pytest.fixture
def supa(monkeypatch):
    monkeypatch.setattr(settings, "supabase_url", "https://proj.supabase.co")
    monkeypatch.setattr(settings, "supabase_service_key", "service-key")
    calls: list[httpx.Request] = []
    state = {"bucket": False, "objects": {}}

    def handler(req: httpx.Request) -> httpx.Response:
        calls.append(req)
        path = req.url.path
        if path == "/storage/v1/bucket":
            state["bucket"] = True
            return httpx.Response(200, json={"name": "submissions"})
        if path.startswith("/storage/v1/object/submissions/"):
            key = path.removeprefix("/storage/v1/object/submissions/")
            if req.method == "POST":
                if not state["bucket"]:
                    return httpx.Response(400, json={"error": "Bucket not found"})
                state["objects"][key] = req.content
                return httpx.Response(200, json={"Key": key})
            if req.method == "GET":
                if key in state["objects"]:
                    return httpx.Response(200, content=state["objects"][key])
                return httpx.Response(400, json={"error": "Object not found"})
        if path == "/storage/v1/object/submissions" and req.method == "DELETE":
            for k in json.loads(req.content)["prefixes"]:
                state["objects"].pop(k, None)
            return httpx.Response(200, json=[])
        return httpx.Response(500)

    provider = SupabaseStorageProvider(client=httpx.Client(transport=httpx.MockTransport(handler)))
    return provider, calls, state


def test_supabase_creates_private_bucket_and_roundtrips(supa):
    provider, calls, state = supa
    assert provider.save("submissions/abc/original.zip", b"ZIPDATA") == "submissions/abc/original.zip"
    # 1) bucket yok -> 2) ozel bucket olustur -> 3) tekrar yukle
    assert [(c.method, c.url.path) for c in calls] == [
        ("POST", "/storage/v1/object/submissions/submissions/abc/original.zip"),
        ("POST", "/storage/v1/bucket"),
        ("POST", "/storage/v1/object/submissions/submissions/abc/original.zip"),
    ]
    assert json.loads(calls[1].content)["public"] is False
    assert calls[0].headers["authorization"] == "Bearer service-key"
    assert calls[0].headers["x-upsert"] == "true"

    assert provider.load("submissions/abc/original.zip") == b"ZIPDATA"
    assert provider.load("submissions/yok/original.zip") is None
    provider.delete(["submissions/abc/original.zip"])
    assert state["objects"] == {}


def test_supabase_requires_credentials(monkeypatch):
    monkeypatch.setattr(settings, "supabase_url", "")
    with pytest.raises(RuntimeError):
        SupabaseStorageProvider()


def test_upload_survives_storage_outage(client, s1, make_assignment, monkeypatch):
    """Depolama cokse bile teslim kaybolmamali (icerik DB'de)."""
    class Down(storage_service.StorageProvider):
        def save(self, key, data): raise RuntimeError("depolama yok")
        def load(self, key): return None
        def delete(self, keys): pass
    import app.routers.submissions as subs_mod
    monkeypatch.setattr(subs_mod, "get_storage_provider", lambda: Down())
    aid = make_assignment(["A olmalı"])
    r = client.post(f"/assignments/{aid}/submissions", headers=s1,
                    files={"file": ("p.zip", zip_bytes({"main.py": "x = 1\n"}), "application/zip")})
    assert r.status_code == 201
    dl = _download(client, s1, r.json()["id"])
    assert dl.status_code == 200 and dl.headers["x-kernel-source"] == "rebuilt"
