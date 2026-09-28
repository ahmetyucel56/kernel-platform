import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { api, ApiError } from "../../api/client";
import type { Community, CommunityPost } from "../../api/types";
import { scopeLabel } from "./CommunityList";
import { formatDate } from "../../lib/format";
import { useAuth } from "../../auth/AuthContext";
import { canModerate } from "../../lib/perm";
import { VoteButton } from "./VoteButton";

export function CommunityDetail() {
  const { communityId = "" } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [community, setCommunity] = useState<Community | null>(null);
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);
  const [sort, setSort] = useState<"new" | "top">("new");

  function refreshPosts() {
    api<CommunityPost[]>(`/communities/${communityId}/posts?sort=${sort}`).then(setPosts).catch(() => {});
  }
  useEffect(() => {
    api<Community>(`/communities/${communityId}`).then(setCommunity).catch(() => {});
  }, [communityId]);
  useEffect(() => {
    api<CommunityPost[]>(`/communities/${communityId}/posts?sort=${sort}`)
      .then(setPosts)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [communityId, sort]);

  async function removeCommunity() {
    if (!window.confirm(`"${community?.name ?? "Topluluk"}" ve tüm gönderileri silinsin mi?`)) return;
    try {
      await api(`/communities/${communityId}`, { method: "DELETE" });
      navigate("/topluluk");
    } catch (e) {
      alert(e instanceof ApiError ? e.message : "Silinemedi.");
    }
  }

  async function removePost(e: React.MouseEvent, p: CommunityPost) {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm(`"${p.title}" gönderisi silinsin mi?`)) return;
    try {
      await api(`/posts/${p.id}`, { method: "DELETE" });
      refreshPosts();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Silinemedi.");
    }
  }

  return (
    <div style={{ paddingBottom: 24, maxWidth: 800 }}>
      <Link to="/topluluk" className="muted" style={{ fontSize: 13 }}>← Topluluklar</Link>
      <div className="row between" style={{ flexWrap: "wrap", gap: 10, marginTop: 8 }}>
        <div>
          {community && <span className="tag tag-blue">{scopeLabel[community.scope]}</span>}
          <h1 className="h-page" style={{ margin: "6px 0 0" }}>{community?.name ?? "Topluluk"}</h1>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {community && canModerate(user, community.created_by) && (
            <button className="btn btn-ghost" style={{ color: "#ff6b6b" }} onClick={removeCommunity}>
              Topluluğu sil
            </button>
          )}
          <button className="btn btn-primary" onClick={() => setComposing((s) => !s)}>
            {composing ? "Vazgeç" : "+ Soru / Gönderi"}
          </button>
        </div>
      </div>

      {composing && (
        <CreatePost
          communityId={communityId}
          onDone={() => { setComposing(false); refreshPosts(); }}
        />
      )}

      <div className="seg" style={{ marginTop: 18, maxWidth: 260 }}>
        <button className={sort === "new" ? "on" : ""} onClick={() => setSort("new")}>
          Yeni
        </button>
        <button className={sort === "top" ? "on" : ""} onClick={() => setSort("top")}>
          Popüler
        </button>
      </div>

      <div className="stack" style={{ marginTop: 12 }}>
        {loading ? (
          <span className="muted">Yükleniyor…</span>
        ) : posts.length === 0 ? (
          <div className="card"><p className="muted">Henüz gönderi yok. İlk soruyu sen sor.</p></div>
        ) : (
          posts.map((p) => (
            <Link key={p.id} to={`/gonderi/${p.id}`} style={{ color: "inherit" }}>
              <div className="card">
                <div className="row between" style={{ gap: 8 }}>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 18 }}>{p.title}</div>
                  <div className="row" style={{ gap: 6 }}>
                    <VoteButton postId={p.id} votes={p.vote_count ?? 0} voted={!!p.i_voted} />
                    {canModerate(user, p.author_id) && (
                      <button
                        className="btn btn-ghost"
                        style={{ padding: "2px 8px", fontSize: 12, color: "#ff6b6b" }}
                        onClick={(e) => removePost(e, p)}
                      >
                        Sil
                      </button>
                    )}
                  </div>
                </div>
                {p.body && (
                  <p className="muted" style={{ marginTop: 4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                    {p.body}
                  </p>
                )}
                <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>
                  {p.author_name} · {formatDate(p.created_at)}
                  {p.edited_at ? " (düzenlendi)" : ""} · {p.reply_count ?? 0} yanıt
                </div>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

function CreatePost({ communityId, onDone }: { communityId: string; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api(`/communities/${communityId}/posts`, {
        method: "POST",
        body: { title, body: body || null },
      });
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Gönderilemedi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <form onSubmit={submit}>
        <div className="field">
          <label>Başlık</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Sorunu kısaca özetle" required />
        </div>
        <div className="field">
          <label>Detay (opsiyonel)</label>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} />
        </div>
        {err && <p className="error">{err}</p>}
        <button className="btn btn-primary" disabled={busy || !title.trim()}>
          {busy ? "…" : "Paylaş"}
        </button>
      </form>
    </div>
  );
}
