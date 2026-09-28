"""Alembic ortami — uygulamanin kendi ayarlarini ve modellerini kullanir.

Iki calisma bicimi:
- Uygulama acilisi (app.db.migrate): hazir bir baglanti config.attributes
  uzerinden gelir; logging'e dokunulmaz (uvicorn loglari bozulmasin).
- Komut satiri (alembic ...): DATABASE_URL'den yeni bir motor kurulur.
"""
from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine

from app import models  # noqa: F401  (tum tablolarin metadata'ya kaydi)
from app.config import settings
from app.db import Base

config = context.config
target_metadata = Base.metadata


def _configure(connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        # SQLite ALTER'i sinirli; tablo kopyalayarak degistirir (Postgres'te etkisiz).
        render_as_batch=connection.dialect.name == "sqlite",
        compare_type=True,
    )


def run_migrations_offline() -> None:
    context.configure(
        url=settings.database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connection = config.attributes.get("connection")
    if connection is not None:  # uygulama icinden
        _configure(connection)
        with context.begin_transaction():
            context.run_migrations()
        return

    if config.config_file_name is not None:
        fileConfig(config.config_file_name)
    engine = create_engine(settings.database_url)
    with engine.connect() as conn:
        _configure(conn)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
