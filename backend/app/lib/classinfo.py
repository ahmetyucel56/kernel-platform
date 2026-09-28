"""Sınıf yardımcıları: sınıf = bölüm grubu, dersler class_courses'ta, ödev bir derse ait."""
from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Class, ClassCourse, Course, Department
from app.schemas import ClassOut, CourseOut


def class_courses(db: Session, class_id: uuid.UUID) -> list[Course]:
    return list(db.scalars(
        select(Course).join(ClassCourse, ClassCourse.course_id == Course.id)
        .where(ClassCourse.class_id == class_id).order_by(Course.name)
    ).all())


def course_names(db: Session, ids) -> dict[uuid.UUID, str]:
    ids = {i for i in ids if i is not None}
    if not ids:
        return {}
    return {c.id: c.name for c in db.scalars(select(Course).where(Course.id.in_(ids)))}


def department_name(db: Session, cls: Class) -> str | None:
    dep = db.get(Department, cls.department_id) if cls.department_id else None
    return dep.name if dep else None


def class_out(db: Session, cls: Class) -> ClassOut:
    out = ClassOut.model_validate(cls)
    out.department_name = department_name(db, cls)
    out.courses = [CourseOut.model_validate(c) for c in class_courses(db, cls.id)]
    return out


def attach_course(db: Session, cls: Class, course_id: uuid.UUID) -> None:
    if not db.scalar(select(ClassCourse).where(ClassCourse.class_id == cls.id,
                                               ClassCourse.course_id == course_id)):
        db.add(ClassCourse(class_id=cls.id, course_id=course_id))
