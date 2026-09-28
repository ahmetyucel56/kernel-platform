"""Hesap guvenligi: eski seed yoneticisi, kilit, sifre degisimi, 2FA, kurucu
kurulumu, kurucu paneli (hesap acma/silme) ve oturum iptali."""
import time

import pytest
from sqlalchemy import select

from app import db as dbmod
from app.config import settings
from app.models import AppSetting, Assignment, Class, Submission, User
from app.security import hash_password
from app.services import account_security as sec

from .conftest import zip_bytes

STRONG = "Mavi-Deniz-4821"
FOUNDER_PW = "Gizli-Kale-Duvari-77"
SETUP_TOKEN = "t" * 32


@pytest.fixture(autouse=True)
def _fresh_ip_limits():
    sec.reset_ip_limits()
    yield
    sec.reset_ip_limits()


def _make_user(no: str, role: str = "student", password: str = STRONG, **extra) -> str:
    with dbmod.SessionLocal() as db:
        u = User(email=f"{no}@test.dev", full_name=f"Kullanıcı {no}", role=role, school_no=no,
                 university="Demo", hashed_password=hash_password(password), **extra)
        db.add(u)
        db.commit()
        return str(u.id)


def _login(client, no: str, password: str = STRONG):
    return client.post("/auth/login-school", json={"university": "Demo", "school_no": no, "password": password})


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_seed_admin_is_neutralized(client):
    with dbmod.SessionLocal() as db:
        db.add(User(email=sec.SEED_ADMIN_EMAIL, full_name="Eski Yönetici", role="admin", school_no="1000",
                    hashed_password=hash_password("parola123")))
        db.commit()
        sec.neutralize_seed_admin(db)
    r = _login(client, "1000", "parola123")
    assert r.status_code == 401


def test_lockout_after_repeated_failures(client):
    _make_user("880001")
    for _ in range(sec.LOCK_AFTER):
        assert _login(client, "880001", "yanlis-sifre-1").status_code == 401
    # Dogru sifre bile kilitliyken reddedilir; kullaniciya bildirim gider
    assert _login(client, "880001").status_code == 429
    with dbmod.SessionLocal() as db:
        u = db.scalar(select(User).where(User.school_no == "880001"))
        u.locked_until = None
        db.commit()
    tok = _login(client, "880001").json()["access_token"]
    notes = client.get("/me/notifications", headers=_h(tok)).json()
    assert any("kilitlendi" in n["message"] for n in notes)
    # Bilinmeyen kullanici da ayni genel hatayi alir (hesap var mi anlasilmaz)
    assert _login(client, "999999999").json()["detail"] == _login(client, "880001", "x-yanlis-9").json()["detail"]


def test_password_change_revokes_other_sessions(client):
    _make_user("880002")
    old = _login(client, "880002").json()["access_token"]
    assert client.post("/auth/change-password", headers=_h(old),
                       json={"current_password": STRONG, "new_password": "parola123"}).status_code == 400  # zayif
    r = client.post("/auth/change-password", headers=_h(old),
                    json={"current_password": STRONG, "new_password": "Yesil-Orman-5930"})
    assert r.status_code == 200
    new = r.json()["access_token"]
    assert client.get("/auth/me", headers=_h(old)).status_code == 401  # eski oturum gecersiz
    assert client.get("/auth/me", headers=_h(new)).status_code == 200
    # Tum cihazlardan cikis: bu oturum da kapanir
    assert client.post("/auth/logout-all", headers=_h(new)).status_code == 204
    assert client.get("/auth/me", headers=_h(new)).status_code == 401


def test_demo_account_cannot_change_password(client, aca):
    r = client.post("/auth/change-password", headers=aca,
                    json={"current_password": "parola123", "new_password": "Yesil-Orman-5930"})
    assert r.status_code == 403


def test_two_factor_flow(client):
    _make_user("880003")
    tok = _login(client, "880003").json()["access_token"]
    assert client.post("/auth/2fa/setup", headers=_h(tok), json={"password": "yanlis"}).status_code == 400
    setup = client.post("/auth/2fa/setup", headers=_h(tok), json={"password": STRONG}).json()
    assert setup["qr"].startswith("data:image/png") and setup["otpauth_uri"].startswith("otpauth://")
    assert client.post("/auth/2fa/enable", headers=_h(tok), json={"code": "000000"}).status_code == 400
    codes = client.post("/auth/2fa/enable", headers=_h(tok),
                        json={"code": sec.totp_now(setup["secret"])}).json()["backup_codes"]
    assert len(codes) == 8

    # Parola tek basina yetmez: once kod adimi
    step1 = _login(client, "880003").json()
    assert step1["mfa_required"] and step1["access_token"] is None
    # Kurulumda kullanilan kod tekrar kullanilamaz; yedek kod bir kez gecer
    assert client.post("/auth/login/2fa", json={"mfa_token": step1["mfa_token"],
                                                "code": sec.totp_now(setup["secret"])}).status_code == 401
    ok = client.post("/auth/login/2fa", json={"mfa_token": step1["mfa_token"], "code": codes[0]})
    assert ok.status_code == 200 and ok.json()["access_token"]
    step1 = _login(client, "880003").json()
    assert client.post("/auth/login/2fa", json={"mfa_token": step1["mfa_token"], "code": codes[0]}).status_code == 401
    sec_info = client.get("/auth/security", headers=_h(ok.json()["access_token"])).json()
    assert sec_info["totp_enabled"] and sec_info["backup_codes_left"] == 7
    assert any(e["event"] == "login_ok" for e in sec_info["events"])


def _founder(client, monkeypatch):
    """Kurucu kurulumu (bir kez) + 2FA'li giris -> (oturum basligi, totp anahtari)."""
    monkeypatch.setattr(settings, "founder_setup_token", SETUP_TOKEN)
    with dbmod.SessionLocal() as db:
        f = db.scalar(select(User).where(User.is_founder.is_(True)))
        if f is None:
            assert client.get("/auth/founder-setup").json()["available"]
            body = {"setup_token": SETUP_TOKEN, "full_name": "Kurucu Kişi", "email": "kurucu@kernel.app",
                    "password": FOUNDER_PW}
            assert client.post("/auth/founder-setup/start", json={**body, "setup_token": "x" * 32}).status_code == 403
            assert client.post("/auth/founder-setup/start",
                               json={**body, "password": "Kisa-parola1"}).status_code == 400  # kurucu: >=14
            start = client.post("/auth/founder-setup/start", json=body).json()
            fin = client.post("/auth/founder-setup/finish",
                              json={"setup_id": start["setup_id"], "code": sec.totp_now(start["secret"])})
            assert fin.status_code == 200 and len(fin.json()["backup_codes"]) == 8
            assert not client.get("/auth/founder-setup").json()["available"]  # bir kez
        f = db.scalar(select(User).where(User.is_founder.is_(True)))
        secret = f.totp_secret
        f.totp_last_step = None  # testte ayni zaman adiminda yeniden giris icin
        db.commit()
    step1 = client.post("/auth/login", json={"email": "kurucu@kernel.app", "password": FOUNDER_PW}).json()
    assert step1["mfa_required"]
    r = client.post("/auth/login/2fa", json={"mfa_token": step1["mfa_token"], "code": sec.totp_now(secret)})
    assert r.status_code == 200 and r.json()["user"]["is_founder"]
    return _h(r.json()["access_token"]), secret


def test_founder_panel_manages_accounts(client, monkeypatch, aca, s1):
    admin, _ = _founder(client, monkeypatch)
    assert client.get("/admin/users", headers=aca).status_code == 403
    assert client.get("/admin/stats", headers=admin).json()["users"]["admin"] >= 1

    # Hesap acma: gecici sifre bir kez; ilk giriste degistirmek zorunlu
    r = client.post("/admin/users", headers=admin,
                    json={"full_name": "Yeni Hoca", "role": "academician", "school_no": "770001"})
    assert r.status_code == 201
    tmp = r.json()["temp_password"]
    tok = _login(client, "770001", tmp).json()["access_token"]
    assert client.get("/classes", headers=_h(tok)).status_code == 403
    tok = client.post("/auth/change-password", headers=_h(tok),
                      json={"current_password": tmp, "new_password": "Lale-Bahce-6621"}).json()["access_token"]
    assert client.get("/classes", headers=_h(tok)).status_code == 200

    uid = r.json()["user"]["id"]
    # Devre disi: acik oturum hemen kapanir, giris reddedilir
    client.patch(f"/admin/users/{uid}", headers=admin, json={"is_active": False})
    assert client.get("/auth/me", headers=_h(tok)).status_code == 401
    assert _login(client, "770001", "Lale-Bahce-6621").status_code == 403
    client.patch(f"/admin/users/{uid}", headers=admin, json={"is_active": True})
    # Sifre sifirlama
    tmp2 = client.post(f"/admin/users/{uid}/reset-password", headers=admin).json()["temp_password"]
    assert _login(client, "770001", tmp2).json()["user"]["must_change_password"]
    # Yonetici hesaplari panelden degistirilemez
    me = client.get("/auth/me", headers=admin).json()["id"]
    assert client.delete(f"/admin/users/{me}", headers=admin).status_code == 403
    events = client.get("/admin/events", headers=admin).json()
    assert {"user_created", "password_reset", "user_updated"} <= {e["event"] for e in events}
    # Demo girisi panelden kapatilip acilabilir
    assert client.put("/admin/settings", headers=admin, json={"demo_login": False}).json()["demo_login"] is False
    assert client.post("/auth/demo-login", json={"role": "student"}).status_code == 403
    client.put("/admin/settings", headers=admin, json={"demo_login": True})
    assert client.post("/auth/demo-login", json={"role": "student"}).status_code == 200
    with dbmod.SessionLocal() as db:  # diger testler env ayarina gore calissin
        db.delete(db.get(AppSetting, "demo_login"))
        db.commit()


def test_delete_teacher_removes_everything(client, monkeypatch):
    admin, _ = _founder(client, monkeypatch)
    teacher = client.post("/admin/users", headers=admin, json={
        "full_name": "Silinecek Hoca", "role": "academician", "school_no": "770002", "is_demo": True}).json()
    student = client.post("/admin/users", headers=admin, json={
        "full_name": "Silinecek Öğrenci", "role": "student", "school_no": "770003", "is_demo": True}).json()
    th = _h(_login(client, "770002", teacher["temp_password"]).json()["access_token"])
    sh = _h(_login(client, "770003", student["temp_password"]).json()["access_token"])
    course = client.get("/courses", headers=th).json()[0]
    cid = client.post("/classes", headers=th, json={"course_id": course["id"], "name": "Silinecek Sınıf"}).json()["id"]
    client.post(f"/classes/{cid}/enroll", headers=th, json={"student_no": "770003"})
    from datetime import datetime, timedelta, timezone
    aid = client.post("/assignments", headers=th, json={
        "class_id": cid, "title": "Silinecek", "requirements": ["x"],
        "deadline_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()}).json()["id"]
    sub = client.post(f"/assignments/{aid}/submissions", headers=sh,
                      files={"file": ("p.zip", zip_bytes({"a.py": "x=1\n"}), "application/zip")}).json()
    client.post(f"/submissions/{sub['id']}/analyze", headers=th, json={"analysis_type": "clean_code"})
    client.post(f"/submissions/{sub['id']}/comments", headers=th, json={"body": "iyi"})

    assert client.delete(f"/admin/users/{teacher['user']['id']}", headers=admin).status_code == 204
    with dbmod.SessionLocal() as db:
        assert db.get(Class, __import__("uuid").UUID(cid)) is None
        assert db.scalar(select(Assignment).where(Assignment.title == "Silinecek")) is None
        assert db.scalar(select(Submission).where(Submission.id == __import__("uuid").UUID(sub["id"]))) is None
    assert client.delete(f"/admin/users/{student['user']['id']}", headers=admin).status_code == 204
    assert _login(client, "770003", student["temp_password"]).status_code == 401
    assert any(e["event"] == "user_deleted" for e in client.get("/admin/events", headers=admin).json())


def test_admin_without_2fa_cannot_log_in(client):
    _make_user("880004", role="admin")
    r = _login(client, "880004")
    assert r.status_code == 403


def test_security_headers(client):
    h = client.get("/health").headers
    assert h["x-frame-options"] == "DENY" and h["x-content-type-options"] == "nosniff"
    assert "no-store" in h["cache-control"]


def test_totp_rejects_replay():
    secret = sec.new_totp_secret()
    step = sec.totp_match(secret, sec.totp_now(secret))
    assert step is not None
    assert sec.totp_match(secret, sec.totp_now(secret), last_step=step) is None
    assert sec.totp_match(secret, sec.totp_now(secret, time.time() - 300)) is None  # eski kod


# --- Cihaz oturumlari (web: httpOnly cerez) -----------------------------------
WEB = {"X-Kernel-Client": "web", "User-Agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0"}


def _cookies(resp) -> dict:
    out = {}
    for raw in resp.headers.get_list("set-cookie"):
        name, _, rest = raw.partition("=")
        out[name] = rest.split(";")[0]
        assert "HttpOnly" in raw and "Secure" in raw and "SameSite=strict" in raw.replace("Strict", "strict")
        assert "Path=/api/auth" in raw
    return out


def test_web_session_cookie_refresh_and_logout(client):
    _make_user("880010")
    r = client.post("/auth/login-school", headers=WEB,
                    json={"university": "Demo", "school_no": "880010", "password": STRONG})
    jar = _cookies(r)
    assert "kernel_rt" in jar and "kernel_did" in jar
    cookie = "; ".join(f"{k}={v}" for k, v in jar.items())
    # Yenileme: cerez + ozel baslik gerekir
    assert client.post("/auth/refresh", headers={"Cookie": cookie}).status_code == 400
    ref = client.post("/auth/refresh", headers={**WEB, "Cookie": cookie})
    assert ref.status_code == 200 and ref.json()["user"]["school_no"] == "880010"
    tok = ref.json()["access_token"]
    sess = client.get("/auth/sessions", headers=_h(tok)).json()
    assert len(sess) == 1 and sess[0]["current"] and sess[0]["device"] == "Chrome · Windows"
    # Cikis: oturum kapanir, erisim token'i da gecersiz olur, cerez silinir
    out = client.post("/auth/logout", headers={**WEB, "Cookie": cookie})
    assert out.status_code == 204 and "kernel_rt=" in out.headers.get("set-cookie", "")
    assert client.get("/auth/me", headers=_h(tok)).status_code == 401
    assert client.post("/auth/refresh", headers={**WEB, "Cookie": cookie}).status_code == 401


def test_new_device_notification_and_remote_close(client):
    _make_user("880011")
    phone = {"X-Device-Id": "telefon-cihaz-kimligi-0001", "User-Agent": "okhttp/4.12 Android"}
    first = client.post("/auth/login-school", headers=phone,
                        json={"university": "Demo", "school_no": "880011", "password": STRONG}).json()["access_token"]
    # Ayni cihazdan tekrar: bildirim yok
    client.post("/auth/login-school", headers=phone, json={"university": "Demo", "school_no": "880011", "password": STRONG})
    notes = lambda t: [n for n in client.get("/me/notifications", headers=_h(t)).json() if "yeni bir cihaz" in n["message"]]  # noqa: E731
    assert notes(first) == []
    # Baska cihaz: bildirim + guvenlik kaydi
    laptop = client.post("/auth/login-school", headers=WEB,
                         json={"university": "Demo", "school_no": "880011", "password": STRONG}).json()["access_token"]
    assert len(notes(first)) == 1 and "Chrome · Windows" in notes(first)[0]["message"]
    # Telefondan, tanimadigi dizustu oturumunu kapatir
    web_sid = next(s["id"] for s in client.get("/auth/sessions", headers=_h(first)).json() if s["client"] == "web")
    assert client.delete(f"/auth/sessions/{web_sid}", headers=_h(first)).status_code == 204
    assert client.get("/auth/me", headers=_h(laptop)).status_code == 401
    assert client.get("/auth/me", headers=_h(first)).status_code == 200


def test_demo_teacher_cannot_touch_real_students(client, aca):
    """'Sifresiz dene' herkese acik: demo hocasi gercek ogrenciyi sinifina ekleyip
    sifresini sifirlayarak hesabi ele geciremez."""
    course = client.get("/courses", headers=aca).json()[0]
    cid = client.post("/classes", headers=aca, json={"course_id": course["id"], "name": "Demo Tuzak"}).json()["id"]
    _make_user("880020")
    r = client.post(f"/classes/{cid}/enroll", headers=aca, json={"student_no": "880020"})
    assert r.status_code == 403
    client.delete(f"/classes/{cid}", headers=aca)  # diger testler hocanin ilk sinifini kullaniyor


def test_teacher_resets_own_student_password(client, aca, s1, monkeypatch):
    admin, _ = _founder(client, monkeypatch)
    t = client.post("/admin/users", headers=admin, json={
        "full_name": "Gerçek Hoca", "role": "academician", "school_no": "770020"}).json()
    th = _h(_login(client, "770020", t["temp_password"]).json()["access_token"])
    th = _h(client.post("/auth/change-password", headers=th, json={
        "current_password": t["temp_password"], "new_password": "Lale-Bahce-6621"}).json()["access_token"])
    course = client.get("/courses", headers=th).json()[0]
    cid = client.post("/classes", headers=th, json={"course_id": course["id"], "name": "Şifre Sınıfı"}).json()["id"]
    sid = _make_user("880012")
    client.post(f"/classes/{cid}/enroll", headers=th, json={"student_no": "880012"})
    old = _login(client, "880012").json()["access_token"]
    # Demo hocasi (herkese acik hesap) hicbir zaman sifre sifirlayamaz
    assert client.post(f"/classes/{cid}/students/{sid}/reset-password", headers=aca).status_code == 403
    r = client.post(f"/classes/{cid}/students/{sid}/reset-password", headers=th)
    assert r.status_code == 200
    tmp = r.json()["temp_password"]
    assert client.get("/auth/me", headers=_h(old)).status_code == 401  # eski oturum kapandi
    assert _login(client, "880012", tmp).json()["user"]["must_change_password"]
    # Sinifta olmayan ogrenci / ogrenci kendisi / demo ogrenci: olmaz
    other = _make_user("880013")
    assert client.post(f"/classes/{cid}/students/{other}/reset-password", headers=th).status_code == 404
    assert client.post(f"/classes/{cid}/students/{sid}/reset-password", headers=s1).status_code == 403
    demo_id = client.get("/auth/me", headers=s1).json()["id"]
    client.post(f"/classes/{cid}/enroll", headers=th, json={"student_no": "2025001"})
    assert client.post(f"/classes/{cid}/students/{demo_id}/reset-password", headers=th).status_code == 403


def test_founder_setup_status_reason(client, monkeypatch):
    monkeypatch.setattr(settings, "founder_setup_token", "")
    r = client.get("/auth/founder-setup").json()
    assert r["available"] is False and r["reason"] in ("no_token", "closed")


def test_demo_account_cannot_kick_other_demo_visitors(client, aca):
    assert client.post("/auth/logout-all", headers=aca).status_code == 403
    assert client.get("/auth/sessions", headers=aca).json() == []
    assert client.get("/auth/me", headers=aca).status_code == 200


def test_email_login_is_only_for_admins(client):
    """E-postali giris yalnizca yonetici icindir; ogrenci/hoca e-postasi yokmus gibi davranir."""
    _make_user("880030")
    r = client.post("/auth/login", json={"email": "880030@test.dev", "password": STRONG})
    assert r.status_code == 401
    assert _login(client, "880030").status_code == 200  # okul no ile girer


def test_privacy_meta_and_security_log_retention(client, monkeypatch):
    assert client.get("/meta/privacy").json()["controller"]
    from datetime import datetime, timedelta, timezone
    from app.models import SecurityEvent
    with dbmod.SessionLocal() as db:
        db.add(SecurityEvent(event="login_ok", created_at=datetime.now(timezone.utc) - timedelta(days=400)))
        db.commit()
        sec.purge_old_security_events(db)
        old = db.scalar(select(SecurityEvent).where(
            SecurityEvent.created_at < datetime.now(timezone.utc) - timedelta(days=366)))
        assert old is None
