"""Topluluk API'si (Sprint 5).

Spec: Faz 1'de yalnizca veri modeli + API endpoint'leri; arayuz Faz 2'de gelecek.
Sinif/bolum/genel kapsamli topluluklar, gonderiler ve yanitlar. Kimlik dogrulamasi
olan herkes topluluk acabilir/gonderi yazabilir (spec: "herkes topluluk acabilir").
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user
from app.models import Class, Community, CommunityPost, CommunityReply, Enrollment, PostVote, User
from app.schemas import (
    CommunityIn,
    CommunityOut,
    PostEditIn,
    PostIn,
    PostOut,
    ReplyIn,
    ReplyOut,
    VoteOut,
)

router = APIRouter(prefix="/communities", tags=["community"])
# Yanitlar gonderi altinda; ayri prefix ile temiz yol (/posts/{id}/replies).
posts_router = APIRouter(prefix="/posts", tags=["community"])


def _names(db: Session, ids: set[uuid.UUID]) -> dict[uuid.UUID, str]:
    if not ids:
        return {}
    rows = db.scalars(select(User).where(User.id.in_(ids))).all()
    return {u.id: u.full_name for u in rows}


def _can_access(db: Session, c: Community, user: User) -> bool:
    """Kapsam kurali: sinif toplulugu yalnizca o sinifin hocasi + kayitli ogrencileri,
    bolum toplulugu yalnizca o bolumdekiler, genel topluluk herkes."""
    if user.role == "admin" or c.scope == "general":
        return True
    if c.scope == "class":
        cls = db.get(Class, c.scope_ref_id) if c.scope_ref_id else None
        if cls is None:
            return False
        if cls.academician_id == user.id:
            return True
        return db.scalar(select(Enrollment).where(
            Enrollment.class_id == cls.id, Enrollment.student_id == user.id)) is not None
    if c.scope == "department":
        return c.scope_ref_id is not None and user.department_id == c.scope_ref_id
    return False


def _is_moderator(db: Session, c: Community, user: User) -> bool:
    """Sinif toplulugunda o sinifin hocasi; bolum/genel toplulukta akademisyenler; admin her yerde."""
    if user.role == "admin":
        return True
    if c.scope == "class":
        cls = db.get(Class, c.scope_ref_id) if c.scope_ref_id else None
        return cls is not None and cls.academician_id == user.id
    # Demo hocasi herkese acik ("Sifresiz dene"): genel/bolum topluluklarinda gercek
    # kullanicilarin gonderilerini silememeli.
    return user.role == "academician" and not user.is_demo


def _community_or_404(db: Session, community_id: uuid.UUID, user: User) -> Community:
    c = db.get(Community, community_id)
    # Erisimi olmayana varligini da belli etme
    if c is None or not _can_access(db, c, user):
        raise HTTPException(status_code=404, detail="Topluluk bulunamadı.")
    return c


def _post_or_404(db: Session, post_id: uuid.UUID, user: User) -> tuple[CommunityPost, Community]:
    p = db.get(CommunityPost, post_id)
    c = db.get(Community, p.community_id) if p else None
    if p is None or c is None or not _can_access(db, c, user):
        raise HTTPException(status_code=404, detail="Gönderi bulunamadı.")
    return p, c


def _ensure_owner_or_mod(db: Session, c: Community, owner_id: uuid.UUID, user: User, what: str) -> None:
    if user.id != owner_id and not _is_moderator(db, c, user):
        raise HTTPException(status_code=403, detail=f"Bu {what} yalnizca sahibi veya moderator silebilir.")


# --- Topluluklar ------------------------------------------------------------
@router.post("", response_model=CommunityOut, status_code=201)
def create_community(
    payload: CommunityIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> CommunityOut:
    # Sinif toplulugunu yalnizca o sinifin hocasi, bolum toplulugunu o bolumdekiler acar
    probe = Community(name=payload.name, scope=payload.scope, scope_ref_id=payload.scope_ref_id)
    if payload.scope == "class" and not _is_moderator(db, probe, user):
        raise HTTPException(status_code=403, detail="Sınıf topluluğunu yalnızca sınıfın hocası açabilir.")
    if payload.scope == "department" and not _can_access(db, probe, user):
        raise HTTPException(status_code=403, detail="Yalnızca kendi bölümün için topluluk açabilirsin.")
    community = Community(
        name=payload.name,
        scope=payload.scope,
        scope_ref_id=payload.scope_ref_id,
        created_by=user.id,
    )
    db.add(community)
    db.commit()
    db.refresh(community)
    return CommunityOut.model_validate(community)


@router.get("", response_model=list[CommunityOut])
def list_communities(
    scope: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[CommunityOut]:
    stmt = select(Community)
    if scope:
        stmt = stmt.where(Community.scope == scope)
    rows = [c for c in db.scalars(stmt.order_by(Community.created_at.desc())).all() if _can_access(db, c, user)]
    counts = dict(
        db.execute(
            select(CommunityPost.community_id, func.count()).group_by(CommunityPost.community_id)
        ).all()
    )
    result = []
    for r in rows:
        out = CommunityOut.model_validate(r)
        out.post_count = int(counts.get(r.id, 0))
        result.append(out)
    return result


@router.get("/{community_id}", response_model=CommunityOut)
def get_community(
    community_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> CommunityOut:
    return CommunityOut.model_validate(_community_or_404(db, community_id, user))


@router.delete("/{community_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_community(
    community_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Toplulugu + tum gonderi ve yanitlarini siler (sahibi veya moderator)."""
    c = _community_or_404(db, community_id, user)
    _ensure_owner_or_mod(db, c, c.created_by, user, "topluluğu")
    post_ids = [
        p.id for p in db.scalars(
            select(CommunityPost).where(CommunityPost.community_id == community_id)
        ).all()
    ]
    if post_ids:
        db.execute(delete(PostVote).where(PostVote.post_id.in_(post_ids)))
        db.execute(delete(CommunityReply).where(CommunityReply.post_id.in_(post_ids)))
        db.execute(delete(CommunityPost).where(CommunityPost.id.in_(post_ids)))
    db.delete(c)
    db.commit()


# --- Gonderiler -------------------------------------------------------------
@router.post("/{community_id}/posts", response_model=PostOut, status_code=201)
def create_post(
    community_id: uuid.UUID,
    payload: PostIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PostOut:
    _community_or_404(db, community_id, user)
    post = CommunityPost(
        community_id=community_id,
        author_id=user.id,
        title=payload.title,
        body=payload.body,
    )
    db.add(post)
    db.commit()
    db.refresh(post)
    out = PostOut.model_validate(post)
    out.author_name = user.full_name
    return out


@router.get("/{community_id}/posts", response_model=list[PostOut])
def list_posts(
    community_id: uuid.UUID,
    sort: Literal["new", "top"] = "new",
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[PostOut]:
    """Gonderiler. sort=new: en yeni ustte; sort=top: en cok oy (esitlikte yanit, sonra yeni)."""
    _community_or_404(db, community_id, user)
    rows = db.scalars(
        select(CommunityPost)
        .where(CommunityPost.community_id == community_id)
        .order_by(CommunityPost.created_at.desc())
    ).all()
    names = _names(db, {p.author_id for p in rows})
    ids = [p.id for p in rows]
    rcounts = dict(
        db.execute(
            select(CommunityReply.post_id, func.count())
            .where(CommunityReply.post_id.in_(ids))
            .group_by(CommunityReply.post_id)
        ).all()
    ) if ids else {}
    vcounts = dict(
        db.execute(
            select(PostVote.post_id, func.count())
            .where(PostVote.post_id.in_(ids))
            .group_by(PostVote.post_id)
        ).all()
    ) if ids else {}
    my_votes = set(
        db.scalars(
            select(PostVote.post_id).where(
                PostVote.post_id.in_(ids), PostVote.user_id == user.id
            )
        ).all()
    ) if ids else set()
    result = []
    for p in rows:
        out = PostOut.model_validate(p)
        out.author_name = names.get(p.author_id)
        out.reply_count = int(rcounts.get(p.id, 0))
        out.vote_count = int(vcounts.get(p.id, 0))
        out.i_voted = p.id in my_votes
        result.append(out)
    if sort == "top":  # rows zaten yeniden eskiye; sort kararlidir
        result.sort(key=lambda o: (-(o.vote_count or 0), -(o.reply_count or 0)))
    return result


@posts_router.get("/{post_id}", response_model=PostOut)
def get_post(
    post_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PostOut:
    p, _c = _post_or_404(db, post_id, user)
    out = PostOut.model_validate(p)
    author = db.get(User, p.author_id)
    out.author_name = author.full_name if author else None
    out.vote_count = int(
        db.scalar(select(func.count()).select_from(PostVote).where(PostVote.post_id == post_id)) or 0
    )
    out.i_voted = db.scalar(
        select(PostVote).where(PostVote.post_id == post_id, PostVote.user_id == user.id)
    ) is not None
    return out


@posts_router.post("/{post_id}/vote", response_model=VoteOut)
def toggle_vote(
    post_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> VoteOut:
    """Gonderiye upvote ver / geri al (toggle)."""
    _post_or_404(db, post_id, user)
    existing = db.scalar(
        select(PostVote).where(PostVote.post_id == post_id, PostVote.user_id == user.id)
    )
    if existing:
        db.delete(existing)
        voted = False
    else:
        db.add(PostVote(post_id=post_id, user_id=user.id))
        voted = True
    db.commit()
    votes = int(
        db.scalar(select(func.count()).select_from(PostVote).where(PostVote.post_id == post_id)) or 0
    )
    return VoteOut(votes=votes, voted=voted)


@posts_router.delete("/{post_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_post(
    post_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Gonderiyi + yanitlarini siler (sahibi veya moderator)."""
    p, c = _post_or_404(db, post_id, user)
    _ensure_owner_or_mod(db, c, p.author_id, user, "gönderiyi")
    db.execute(delete(PostVote).where(PostVote.post_id == post_id))
    db.execute(delete(CommunityReply).where(CommunityReply.post_id == post_id))
    db.delete(p)
    db.commit()


def _ensure_author(owner_id: uuid.UUID, user: User, what: str) -> None:
    """Duzenleme yalnizca yazara aittir; moderator silebilir ama baskasinin
    sozlerini degistiremez."""
    if user.id != owner_id:
        raise HTTPException(status_code=403, detail=f"Bu {what} yalnızca yazarı düzenleyebilir.")


@posts_router.patch("/{post_id}", response_model=PostOut)
def edit_post(
    post_id: uuid.UUID,
    payload: PostEditIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PostOut:
    p, _c = _post_or_404(db, post_id, user)
    _ensure_author(p.author_id, user, "gönderiyi")
    changed = False
    if payload.title is not None and payload.title != p.title:
        p.title = payload.title
        changed = True
    if "body" in payload.model_fields_set and payload.body != p.body:
        p.body = payload.body or None
        changed = True
    if changed:
        p.edited_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(p)
    return get_post(post_id, db, user)


# --- Yanitlar ---------------------------------------------------------------
@posts_router.post("/{post_id}/replies", response_model=ReplyOut, status_code=201)
def create_reply(
    post_id: uuid.UUID,
    payload: ReplyIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ReplyOut:
    _post_or_404(db, post_id, user)
    reply = CommunityReply(post_id=post_id, author_id=user.id, body=payload.body)
    db.add(reply)
    db.commit()
    db.refresh(reply)
    out = ReplyOut.model_validate(reply)
    out.author_name = user.full_name
    return out


@posts_router.get("/{post_id}/replies", response_model=list[ReplyOut])
def list_replies(
    post_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[ReplyOut]:
    _post_or_404(db, post_id, user)
    rows = db.scalars(
        select(CommunityReply)
        .where(CommunityReply.post_id == post_id)
        .order_by(CommunityReply.created_at.asc())
    ).all()
    names = _names(db, {r.author_id for r in rows})
    result = []
    for r in rows:
        out = ReplyOut.model_validate(r)
        out.author_name = names.get(r.author_id)
        result.append(out)
    return result


@posts_router.patch("/{post_id}/replies/{reply_id}", response_model=ReplyOut)
def edit_reply(
    post_id: uuid.UUID,
    reply_id: uuid.UUID,
    payload: ReplyIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ReplyOut:
    _post_or_404(db, post_id, user)
    r = db.get(CommunityReply, reply_id)
    if r is None or r.post_id != post_id:
        raise HTTPException(status_code=404, detail="Yanıt bulunamadı.")
    _ensure_author(r.author_id, user, "yanıtı")
    if payload.body != r.body:
        r.body = payload.body
        r.edited_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(r)
    out = ReplyOut.model_validate(r)
    out.author_name = user.full_name
    return out


@posts_router.delete("/{post_id}/replies/{reply_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_reply(
    post_id: uuid.UUID,
    reply_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Yaniti siler (sahibi veya moderator)."""
    _p, c = _post_or_404(db, post_id, user)
    r = db.get(CommunityReply, reply_id)
    if r is None or r.post_id != post_id:
        raise HTTPException(status_code=404, detail="Yanıt bulunamadı.")
    _ensure_owner_or_mod(db, c, r.author_id, user, "yanıtı")
    db.delete(r)
    db.commit()
