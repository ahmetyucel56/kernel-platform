"""cihaz oturumlari (httpOnly yenileme cerezi, aktif oturumlar, yeni cihaz bildirimi)

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-25 18:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0004'
down_revision: Union[str, None] = '0003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Alembic oncesi DB yolunda tablo guncel modelle kurulmus olabilir.
    if "user_sessions" in set(sa.inspect(op.get_bind()).get_table_names()):
        return
    op.create_table(
        "user_sessions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("client", sa.String(10), nullable=False),
        sa.Column("secret_hash", sa.String(64), nullable=True),
        sa.Column("device_hash", sa.String(64), nullable=True),
        sa.Column("user_agent", sa.String(300), nullable=True),
        sa.Column("ip", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_user_sessions_user_id", "user_sessions", ["user_id"])
    op.create_index("ix_user_sessions_device_hash", "user_sessions", ["device_hash"])


def downgrade() -> None:
    op.drop_index("ix_user_sessions_device_hash", "user_sessions")
    op.drop_index("ix_user_sessions_user_id", "user_sessions")
    op.drop_table("user_sessions")
