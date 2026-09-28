"""Kayit guvenligi ve tek tik demo girisi."""
from app.config import settings


def test_no_self_registration_at_all(client):
    """Disaridan hesap acma ozelligi YOK (hesaplari yonetici acar; ileride OBS)."""
    body = {"university": "Demo", "full_name": "Kötü Niyetli", "school_no": "666",
            "password": "Mavi-Deniz-4821", "role": "student"}
    assert client.post("/auth/register-school", json=body).status_code in (404, 405)
    assert client.post("/auth/register", json={"email": "x@y.com", "full_name": "X",
                                               "password": "Mavi-Deniz-4821"}).status_code in (404, 405)
    paths = client.get("/openapi.json").json()["paths"]
    assert not any("register" in p for p in paths)


def test_demo_login(client, monkeypatch):
    # conftest SEED_ON_START=true -> demo acik
    assert client.get("/auth/demo").json() == {"enabled": True}
    r = client.post("/auth/demo-login", json={"role": "academician"})
    assert r.status_code == 200 and r.json()["user"]["school_no"] == "9001"
    assert client.post("/auth/demo-login", json={"role": "student"}).json()["user"]["role"] == "student"
    assert client.post("/auth/demo-login", json={"role": "admin"}).status_code == 404  # yonetici demo yok

    monkeypatch.setattr(settings, "demo_login", False)
    assert client.get("/auth/demo").json() == {"enabled": False}
    assert client.post("/auth/demo-login", json={"role": "academician"}).status_code == 403
