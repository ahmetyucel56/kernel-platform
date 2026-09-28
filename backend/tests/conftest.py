"""Test ortami: gecici SQLite + mock AI + demo seed.

Ayarlar ve DB motoru import aninda olusur; bu yuzden ortam degiskenleri
`app` import edilmeden ONCE ayarlanir. Gercek .env'deki anahtarlar kullanilmaz.
"""
import io
import os
import tempfile
import zipfile
from datetime import datetime, timedelta, timezone

_TMP = tempfile.mkdtemp(prefix="kernel-test-")
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(_TMP, "test.db").replace("\\", "/")
os.environ["AI_PROVIDER"] = "mock"
os.environ["ANTHROPIC_API_KEY"] = ""
os.environ["SEED_ON_START"] = "true"
os.environ["SEED_DEMO_CLASS"] = "false"  # tanitim sinifi test_demo_seed'de ayrica denenir
os.environ["AUTO_CREATE_TABLES"] = "true"
os.environ["STORAGE_DIR"] = os.path.join(_TMP, "storage")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

ACADEMICIAN = "9001"
STUDENT_1 = "2025001"
STUDENT_2 = "2025002"


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:  # lifespan -> tablolar + seed
        yield c


def _login(client, school_no: str) -> dict:
    r = client.post("/auth/login-school",
                    json={"university": "Demo", "school_no": school_no, "password": "parola123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="session")
def aca(client):
    return _login(client, ACADEMICIAN)


@pytest.fixture(scope="session")
def s1(client):
    return _login(client, STUDENT_1)


@pytest.fixture(scope="session")
def s2(client):
    return _login(client, STUDENT_2)


@pytest.fixture(scope="session")
def class_id(client, aca):
    classes = client.get("/classes", headers=aca).json()
    assert classes, "seed en az bir sinif olusturmali"
    return classes[0]["id"]


def zip_bytes(files: dict[str, str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for path, content in files.items():
            z.writestr(path, content)
    return buf.getvalue()


@pytest.fixture
def make_assignment(client, aca, class_id):
    def _make(requirements: list[str], title: str = "Test ödevi", days: int = 3) -> str:
        r = client.post("/assignments", headers=aca, json={
            "class_id": class_id, "title": title, "description": None,
            "requirements": requirements,
            "deadline_at": (datetime.now(timezone.utc) + timedelta(days=days)).isoformat(),
        })
        assert r.status_code == 201, r.text
        return r.json()["id"]
    return _make


@pytest.fixture
def submit(client):
    def _submit(headers: dict, assignment_id: str, files: dict[str, str]) -> dict:
        r = client.post(f"/assignments/{assignment_id}/submissions", headers=headers,
                        files={"file": ("proje.zip", zip_bytes(files), "application/zip")})
        assert r.status_code == 201, r.text
        return r.json()
    return _submit
