"""Veritabani baglantisi ve oturum yonetimi.

DATABASE_URL herhangi bir SQLAlchemy destekli veritabanina isaret edebilir:
- sqlite:///./kernel.db        (yerel, kurulum gerektirmez)
- postgresql+psycopg://...     (Supabase / Postgres)
"""
import json
from collections.abc import Generator
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings

_is_sqlite = settings.database_url.startswith("sqlite")


def _json_serializer(obj) -> str:
    # JSON kolonlarindaki UUID/datetime gibi turleri guvenle string'e cevir.
    return json.dumps(obj, default=str, ensure_ascii=False)

if _is_sqlite:
    engine = create_engine(
        settings.database_url,
        # SQLite'i FastAPI'nin threadpool'unda kullanabilmek icin gerekli.
        connect_args={"check_same_thread": False},
        json_serializer=_json_serializer,
    )

    @event.listens_for(engine, "connect")
    def _sqlite_fk_on(dbapi_conn, _record):
        # SQLite yabanci anahtarlari varsayilan olarak DENETLEMEZ; Postgres denetler.
        # Acik olmazsa silme sirasi hatalari yerelde/testte gorunmez, canlida 500 olur.
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()
else:
    # Postgres/Supabase: bosta kalan baglantilari geri donustur (pooler kapatir),
    # ucretsiz katmani tuketmemek icin mutedil havuz.
    engine = create_engine(
        settings.database_url,
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=5,
        pool_recycle=300,
        json_serializer=_json_serializer,
    )

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


BASELINE_REVISION = "0001"
_BACKEND_DIR = Path(__file__).resolve().parent.parent
# Acilista ulasilan sema surumu (/health bunu raporlar; her istekte DB'ye gitmez).
schema_revision: str | None = None


def init_db() -> None:
    """Semayi guncel surume getirir (acilista; AUTO_CREATE_TABLES=true iken)."""
    migrate()


def _alembic_config():
    from alembic.config import Config

    cfg = Config(str(_BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(_BACKEND_DIR / "migrations"))
    return cfg


def migrate(bind=None) -> None:
    """Alembic ile `upgrade head`.

    Alembic oncesi kurulmus veritabanlari (tablolar var ama alembic_version yok —
    canli Supabase boyle): once eski yontemle eksik tablo/kolonlar tamamlanir,
    sonra baseline'a stamp edilir; boylece hicbir sey yeniden olusturulmaz ve
    sonraki gecisler normal sekilde uygulanir.
    """
    global schema_revision
    from alembic import command
    from alembic.migration import MigrationContext
    from sqlalchemy import inspect

    from app import models  # noqa: F401  (modellerin metadata'ya kaydi icin)

    eng = bind or engine
    cfg = _alembic_config()
    tables = set(inspect(eng).get_table_names())
    with eng.begin() as conn:
        cfg.attributes["connection"] = conn
        if "alembic_version" not in tables and "users" in tables:
            Base.metadata.create_all(bind=conn)
            ensure_columns(conn)
            command.stamp(cfg, BASELINE_REVISION)
        command.upgrade(cfg, "head")
        if bind is None:
            schema_revision = MigrationContext.configure(conn).get_current_revision()


# YALNIZCA Alembic oncesi veritabanlari icin (migrate icindeki tek seferlik yol).
# Yeni kolonlari BURAYA EKLEME — models.py'yi degistir ve bir Alembic gecisi uret
# (backend/alembic.ini'deki talimat).
_EXTRA_COLUMNS: dict[str, dict[str, str]] = {
    "users": {"school_no": "VARCHAR(50)", "university": "VARCHAR(200)"},
    "assignments": {
        "precheck_enabled": "BOOLEAN NOT NULL DEFAULT FALSE",
        "precheck_limit": "INTEGER NOT NULL DEFAULT 3",
    },
    "community_posts": {"edited_at": "TIMESTAMP WITH TIME ZONE"},
    "community_replies": {"edited_at": "TIMESTAMP WITH TIME ZONE"},
}


def ensure_columns(conn=None) -> None:
    """Eski tablolara sonradan eklenmis kolonlari idempotent sekilde tamamlar."""
    from sqlalchemy import inspect, text

    if conn is None:
        with engine.begin() as c:
            return ensure_columns(c)
    insp = inspect(conn)
    tables = set(insp.get_table_names())
    for table, cols in _EXTRA_COLUMNS.items():
        if table not in tables:
            continue
        existing = {c["name"] for c in insp.get_columns(table)}
        for name, ddl in cols.items():
            if name not in existing:
                conn.execute(text(f'ALTER TABLE "{table}" ADD COLUMN {name} {ddl}'))
