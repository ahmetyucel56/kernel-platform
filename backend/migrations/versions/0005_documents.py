"""belge/görsel teslimi: ödev teslim türü + belgeden çıkarılan metin

Revision ID: 0005
Revises: 0004
Create Date: 2026-09-28 20:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0005'
down_revision: Union[str, None] = '0004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if "submission_kind" not in {c["name"] for c in insp.get_columns("assignments")}:
        op.add_column("assignments", sa.Column("submission_kind", sa.String(20), nullable=False, server_default="code"))
    if "extracted_text" not in {c["name"] for c in insp.get_columns("submission_files")}:
        op.add_column("submission_files", sa.Column("extracted_text", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("submission_files") as batch:
        batch.drop_column("extracted_text")
    with op.batch_alter_table("assignments") as batch:
        batch.drop_column("submission_kind")
