"""hesap guvenligi: kurucu, demo isareti, kilit, 2FA, oturum surumu, guvenlik kayitlari

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-25 12:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0003'
down_revision: Union[str, None] = '0002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_USER_COLUMNS = [
    ("is_founder", lambda: sa.Column("is_founder", sa.Boolean(), nullable=False, server_default=sa.false())),
    ("is_demo", lambda: sa.Column("is_demo", sa.Boolean(), nullable=False, server_default=sa.false())),
    ("is_active", lambda: sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true())),
    ("token_version", lambda: sa.Column("token_version", sa.Integer(), nullable=False, server_default="0")),
    ("must_change_password", lambda: sa.Column("must_change_password", sa.Boolean(), nullable=False,
                                               server_default=sa.false())),
    ("failed_logins", lambda: sa.Column("failed_logins", sa.Integer(), nullable=False, server_default="0")),
    ("locked_until", lambda: sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True)),
    ("last_login_at", lambda: sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True)),
    ("totp_secret", lambda: sa.Column("totp_secret", sa.String(64), nullable=True)),
    ("totp_enabled", lambda: sa.Column("totp_enabled", sa.Boolean(), nullable=False, server_default=sa.false())),
    ("totp_last_step", lambda: sa.Column("totp_last_step", sa.Integer(), nullable=True)),
    ("backup_codes", lambda: sa.Column("backup_codes", sa.JSON(), nullable=True)),
]


def upgrade() -> None:
    # Alembic oncesi DB yolunda tablolar guncel modelle kurulmus olabilir: var olan atlanir.
    insp = sa.inspect(op.get_bind())
    existing = {c["name"] for c in insp.get_columns("users")}
    for name, make in _USER_COLUMNS:
        if name not in existing:
            op.add_column("users", make())
    tables = set(insp.get_table_names())
    if "security_events" not in tables:
        op.create_table(
            "security_events",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("event", sa.String(40), nullable=False),
            sa.Column("ip", sa.String(64), nullable=True),
            sa.Column("user_agent", sa.String(300), nullable=True),
            sa.Column("detail", sa.String(300), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_security_events_user_id", "security_events", ["user_id"])
        op.create_index("ix_security_events_created_at", "security_events", ["created_at"])
    if "app_settings" not in tables:
        op.create_table(
            "app_settings",
            sa.Column("key", sa.String(64), primary_key=True),
            sa.Column("value", sa.Text(), nullable=False),
        )
    # Seed'in olusturdugu tanitim hesaplari (@kernel.dev) demo olarak isaretlenir.
    op.execute("UPDATE users SET is_demo = true WHERE email LIKE '%@kernel.dev'")


def downgrade() -> None:
    op.drop_table("app_settings")
    op.drop_index("ix_security_events_created_at", "security_events")
    op.drop_index("ix_security_events_user_id", "security_events")
    op.drop_table("security_events")
    with op.batch_alter_table("users") as batch:
        for name, _ in reversed(_USER_COLUMNS):
            batch.drop_column(name)
