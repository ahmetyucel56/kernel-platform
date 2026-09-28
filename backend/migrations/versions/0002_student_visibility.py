"""odevde AI sonuclarinin ogrenciye gorunurlugu (hocanin karari)

Mevcut odevlerde bugunku davranis korunur (varsayilan: gorunur).

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-24 21:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0002'
down_revision: Union[str, None] = '0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Duz ADD COLUMN (varsayilanli NOT NULL) hem Postgres hem SQLite'ta desteklenir.
    # Alembic oncesi DB yolunda tablo guncel modelle kurulmus olabilir: var olan sutun atlanir.
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("assignments")}
    for name in ("show_requirement_to_student", "show_clean_code_to_student"):
        if name not in existing:
            op.add_column('assignments', sa.Column(name, sa.Boolean(),
                                                   nullable=False, server_default=sa.true()))


def downgrade() -> None:
    with op.batch_alter_table('assignments') as batch:
        batch.drop_column('show_clean_code_to_student')
        batch.drop_column('show_requirement_to_student')
