import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, ApiError } from "../../api/client";
import type { CommunityPost, CommunityReply } from "../../api/types";
import { formatDate } from "../../lib/format";
import { useAuth } from "../../auth/AuthContext";
import { canModerate } from "../../lib/perm";
import { VoteButton } from "./VoteButton";

export function PostDetail() {
  const { postId = "" } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [post, setPost] = useState<CommunityPost | null>(null);
  const [replies, setReplies] = useState<CommunityReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editingPost, setEditingPost] = useState(false);
  const [editingReply, setEditingReply] = useState<string | null>(null);

  function refresh() {
    api<CommunityReply[]>(`/posts/${postId}/replies`).then(setReplies).catch(() => {});
  }
  useEffect(() => {
    api<CommunityPost>(`/posts/${postId}`).then(setPost).catch(() => {});
    api<CommunityReply[]>(`/posts/${postId}/replies`)
      .then(setReplies)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [postId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api(`/posts/${postId}/replies`, { method: "POST", body: { body } });
      setBody("");
      refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Yanıt gönderilemedi.");
    } finally {
      setBusy(false);
    }
  }

  async function removePost() {
    if (!window.confirm("Gönderi silinsin mi?")) return;
    try {
      await api(`/posts/${postId}`, { method: "DELETE" });
      navigate(-1);
    } catch (e) {
      alert(e instanceof ApiError ? e.message : "Silinemedi.");
    }
  }

  async function removeReply(rid: string) {
    if (!window.confirm("Yanıt silinsin mi?")) return;
    try {
      await api(`/posts/${postId}/replies/${rid}`, { method: "DELETE" });
      refresh();
    } catch (e) {
      alert(e instanceof ApiError ? e.message : "Silinemedi.");
    }
  }

  return (
    <div style={{ paddingBottom: 24, maxWidth: 760 }}>
      <button className="btn btn-ghost" onClick={() => navigate(-1)} style={{ marginBottom: 12 }}>
        ← Geri
      </button>

      {post && (
        <div className="card" style={{ marginBottom: 20 }}>
          {editingPost ? (
            <EditPostForm post={post} onCancel={() => setEditingPost(false)} onSaved={(p) => { setPost(p); setEditingPost(false); }} />
          ) : (
            <>
              <div className="row between" style={{ gap: 8 }}>
                <h1 className="h-page" style={{ margin: 0 }}>{post.title}</h1>
                <div className="row" style={{ gap: 6 }}>
                  <VoteButton postId={post.id} votes={post.vote_count ?? 0} voted={!!post.i_voted} />
                  {user?.id === post.author_id && (
                    <button className="btn btn-ghost" onClick={() => setEditingPost(true)}>
                      Düzenle
                    </button>
                  )}
                  {canModerate(user, post.author_id) && (
                    <button className="btn btn-ghost" style={{ color: "#ff6b6b" }} onClick={removePost}>
                      Sil
                    </button>
                  )}
                </div>
              </div>
              {post.body && <div style={{ marginTop: 10, whiteSpace: "pre-wrap" }}>{post.body}</div>}
              <div className="faint" style={{ fontSize: 12, marginTop: 12 }}>
                {post.author_name} · {formatDate(post.created_at)}
                {post.edited_at ? ` · düzenlendi ${formatDate(post.edited_at)}` : ""}
              </div>
            </>
          )}
        </div>
      )}

      <div className="muted" style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
        {replies.length} yanıt
      </div>

      {loading ? (
        <span className="muted">Yükleniyor…</span>
      ) : replies.length === 0 ? (
        <div className="card"><p className="muted">Henüz yanıt yok. İlk yanıtı sen yaz.</p></div>
      ) : (
        <div className="stack">
          {replies.map((r) => (
            <div key={r.id} className="card">
              <div className="row between" style={{ gap: 8, marginBottom: 6 }}>
                <div className="row" style={{ gap: 8 }}>
                  <span className="tag tag-gold">{r.author_name}</span>
                  <span className="faint" style={{ fontSize: 12 }}>
                    {formatDate(r.created_at)}
                    {r.edited_at ? " · düzenlendi" : ""}
                  </span>
                </div>
                <div className="row" style={{ gap: 4 }}>
                  {user?.id === r.author_id && editingReply !== r.id && (
                    <button
                      className="btn btn-ghost"
                      style={{ padding: "2px 8px", fontSize: 12 }}
                      onClick={() => setEditingReply(r.id)}
                    >
                      Düzenle
                    </button>
                  )}
                  {canModerate(user, r.author_id) && (
                    <button
                      className="btn btn-ghost"
                      style={{ padding: "2px 8px", fontSize: 12, color: "#ff6b6b" }}
                      onClick={() => removeReply(r.id)}
                    >
                      Sil
                    </button>
                  )}
                </div>
              </div>
              {editingReply === r.id ? (
                <EditReplyForm
                  postId={postId}
                  reply={r}
                  onCancel={() => setEditingReply(null)}
                  onSaved={() => { setEditingReply(null); refresh(); }}
                />
              ) : (
                <div style={{ whiteSpace: "pre-wrap" }}>{r.body}</div>
              )}
            </div>
          ))}
        </div>
      )}

      <form onSubmit={submit} style={{ marginTop: 18 }}>
        <div className="field">
          <label>Yanıtın</label>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} required />
        </div>
        {err && <p className="error">{err}</p>}
        <button className="btn btn-primary" disabled={busy || !body.trim()}>
          {busy ? "…" : "Yanıtla"}
        </button>
      </form>
    </div>
  );
}

function EditPostForm({
  post,
  onCancel,
  onSaved,
}: {
  post: CommunityPost;
  onCancel: () => void;
  onSaved: (p: CommunityPost) => void;
}) {
  const [title, setTitle] = useState(post.title);
  const [body, setBody] = useState(post.body ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      onSaved(await api<CommunityPost>(`/posts/${post.id}`, {
        method: "PATCH",
        body: { title: title.trim(), body: body.trim() || null },
      }));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save}>
      <div className="field">
        <label>Başlık</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} required />
      </div>
      <div className="field">
        <label>Detay</label>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} />
      </div>
      {err && <p className="error">{err}</p>}
      <div className="row" style={{ gap: 8 }}>
        <button className="btn btn-primary" disabled={busy || !title.trim()}>{busy ? "…" : "Kaydet"}</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Vazgeç</button>
      </div>
    </form>
  );
}

function EditReplyForm({
  postId,
  reply,
  onCancel,
  onSaved,
}: {
  postId: string;
  reply: CommunityReply;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [body, setBody] = useState(reply.body);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api(`/posts/${postId}/replies/${reply.id}`, { method: "PATCH", body: { body: body.trim() } });
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save}>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} required />
      {err && <p className="error">{err}</p>}
      <div className="row" style={{ gap: 8, marginTop: 8 }}>
        <button className="btn btn-primary" disabled={busy || !body.trim()} style={{ padding: "6px 14px" }}>
          {busy ? "…" : "Kaydet"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel} style={{ padding: "6px 14px" }}>
          Vazgeç
        </button>
      </div>
    </form>
  );
}
