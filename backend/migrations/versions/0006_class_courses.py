"""sınıf = bölüm grubu: sınıfa birden çok ders, ödev bir derse ait

Revision ID: 0006
Revises: 0005
Create Date: 2026-09-29 10:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0006'
down_revision: Union[str, None] = '0005'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    class_cols = {c["name"]: c for c in insp.get_columns("classes")}

    with op.batch_alter_table("classes") as batch:
        if "department_id" not in class_cols:
            batch.add_column(sa.Column("department_id", sa.Uuid(), nullable=True))
            batch.create_foreign_key("fk_classes_department_id", "departments", ["department_id"], ["id"])
        if not class_cols["course_id"]["nullable"]:
            batch.alter_column("course_id", existing_type=sa.Uuid(), nullable=True)

    if "course_id" not in {c["name"] for c in insp.get_columns("assignments")}:
        with op.batch_alter_table("assignments") as batch:
            batch.add_column(sa.Column("course_id", sa.Uuid(), nullable=True))
            batch.create_foreign_key("fk_assignments_course_id", "courses", ["course_id"], ["id"])

    if "class_courses" not in insp.get_table_names():
        op.create_table(
            "class_courses",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("class_id", sa.Uuid(), nullable=False),
            sa.Column("course_id", sa.Uuid(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["class_id"], ["classes.id"]),
            sa.ForeignKeyConstraint(["course_id"], ["courses.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("class_id", "course_id", name="uq_class_course"),
        )

    # İlk kurulumdaki bölüm adı Türkçe karaktersiz yazılmıştı
    bind.execute(sa.text("UPDATE departments SET name = :new WHERE name = :old"),
                 {"new": "Bilgisayar Programcılığı", "old": "Bilgisayar Programciligi"})

    # Mevcut veri: sınıfın tek dersi sınıfa eklenir, bölümü dersinden gelir,
    # sınıftaki ödevler o derse bağlanır.
    import uuid as _uuid
    rows = bind.execute(sa.text(
        "SELECT c.id, c.course_id, co.department_id FROM classes c "
        "JOIN courses co ON co.id = c.course_id")).fetchall()
    cc = sa.table("class_courses", sa.column("id", sa.Uuid()), sa.column("class_id", sa.Uuid()),
                  sa.column("course_id", sa.Uuid()))
    classes = sa.table("classes", sa.column("id", sa.Uuid()), sa.column("department_id", sa.Uuid()))
    assignments = sa.table("assignments", sa.column("class_id", sa.Uuid()), sa.column("course_id", sa.Uuid()))
    existing = {(r[0], r[1]) for r in bind.execute(sa.select(cc.c.class_id, cc.c.course_id))}
    for class_id, course_id, dep_id in rows:
        class_id = _uuid.UUID(str(class_id)) if not isinstance(class_id, _uuid.UUID) else class_id
        course_id = _uuid.UUID(str(course_id)) if not isinstance(course_id, _uuid.UUID) else course_id
        dep_id = _uuid.UUID(str(dep_id)) if dep_id is not None and not isinstance(dep_id, _uuid.UUID) else dep_id
        if (class_id, course_id) not in existing:
            bind.execute(cc.insert().values(id=_uuid.uuid4(), class_id=class_id, course_id=course_id))
        bind.execute(classes.update().where(classes.c.id == class_id, classes.c.department_id.is_(None))
                     .values(department_id=dep_id))
        bind.execute(assignments.update().where(assignments.c.class_id == class_id,
                                                assignments.c.course_id.is_(None)).values(course_id=course_id))


def downgrade() -> None:
    op.drop_table("class_courses")
    with op.batch_alter_table("assignments") as batch:
        batch.drop_constraint("fk_assignments_course_id", type_="foreignkey")
        batch.drop_column("course_id")
    with op.batch_alter_table("classes") as batch:
        batch.drop_constraint("fk_classes_department_id", type_="foreignkey")
        batch.drop_column("department_id")
