"""Alembic gecisleri: modellerle uyum, bos DB kurulumu, Alembic oncesi DB'nin stamp'lenmesi."""
import os
import tempfile

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text

import app.db as dbmod
from app.db import Base


def _temp_engine():
    path = os.path.join(tempfile.mkdtemp(), "m.db")
    return create_engine("sqlite:///" + path.replace("\\", "/"))


def _head() -> str:
    return ScriptDirectory.from_config(dbmod._alembic_config()).get_current_head()


def _version(eng) -> str:
    with eng.connect() as c:
        return c.execute(text("SELECT version_num FROM alembic_version")).scalar_one()


def test_models_and_migrations_are_in_sync(client):
    """models.py degisip gecis uretilmediyse bu test kirilir."""
    with dbmod.engine.connect() as conn:
        mc = MigrationContext.configure(conn, opts={"compare_type": True})
        diff = compare_metadata(mc, Base.metadata)
    assert diff == [], f"Model ile gecisler uyumsuz; 'alembic revision --autogenerate' gerekli: {diff}"


def test_app_database_is_at_head(client):
    assert _version(dbmod.engine) == _head()


def test_fresh_database_is_built_by_migrations():
    eng = _temp_engine()
    dbmod.migrate(bind=eng)
    tables = set(inspect(eng).get_table_names())
    assert tables == set(Base.metadata.tables) | {"alembic_version"}
    assert _version(eng) == _head()
    dbmod.migrate(bind=eng)  # idempotent


def test_pre_alembic_database_is_stamped_without_data_loss():
    """Canli Supabase: tablolar create_all ile kurulmus, alembic_version yok,
    bazi yeni kolonlar eksik. Veri korunmali, eksikler tamamlanmali, stamp edilmeli."""
    eng = _temp_engine()
    Base.metadata.create_all(bind=eng)
    with eng.begin() as c:
        c.execute(text("ALTER TABLE community_posts DROP COLUMN edited_at"))
        c.execute(text("ALTER TABLE assignments DROP COLUMN precheck_limit"))
        c.execute(text("DROP TABLE prechecks"))
        c.execute(text("INSERT INTO departments (id, name) VALUES ('11111111111111111111111111111111', 'Bilgisayar')"))

    dbmod.migrate(bind=eng)

    insp = inspect(eng)
    assert "edited_at" in {c["name"] for c in insp.get_columns("community_posts")}
    assert "precheck_limit" in {c["name"] for c in insp.get_columns("assignments")}
    assert "prechecks" in insp.get_table_names()
    assert _version(eng) == _head()
    with eng.connect() as c:
        assert c.execute(text("SELECT name FROM departments")).scalar_one() == "Bilgisayar"
