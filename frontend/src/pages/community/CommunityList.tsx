import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../../api/client";
import type { Community, CommunityScope } from "../../api/types";
import { useAuth } from "../../auth/AuthContext";
import { canModerate } from "../../lib/perm";

export const scopeLabel: Record<CommunityScope, string> = {
  general: "Genel",
  class: "Sınıf",
  department: "Bölüm",
};

export function CommunityList() {
  const { user } = useAuth();
  const [communities, setCommunities] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  function refresh() {
    api<Community[]>("/communities")
      .then(setCommunities)
      .catch(() => {})
      .finally(() => setLoading(false));
  }
  useEffect(refresh, []);

  async function remove(e: React.MouseEvent, c: Community) {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm(`"${c.name}" topluluğu ve tüm gönderileri silinsin mi?`)) return;
    try {
      await api(`/communities/${c.id}`, { method: "DELETE" });
      refresh();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Silinemedi.");
    }
  }

  return (
    <div style={{ paddingBottom: 24 }}>
      <div className="row between" style={{ flexWrap: "wrap", gap: 10, marginBottom: 4 }}>
        <h1 className="h-page" style={{ margin: 0 }}>
          Topluluk
        </h1>
        <button className="btn btn-primary" onClick={() => setCreating((s) => !s)}>
          {creating ? "Vazgeç" : "+ Topluluk oluştur"}
        </button>
      </div>
      <p className="muted" style={{ marginTop: 4, marginBottom: 20 }}>
        Sınıf, bölüm veya genel konularda soru sor, tartış, yardımlaş.
      </p>

      {creating && <CreateCommunity onDone={() => { setCreating(false); refresh(); }} />}

      {loading ? (
        <span className="muted">Yükleniyor…</span>
      ) : communities.length === 0 ? (
        <div className="card">
          <p className="muted">Henüz topluluk yok. İlk topluluğu sen oluştur.</p>
        </div>
      ) : (
        <div className="cols-2-eq">
          {communities.map((c) => (
            <Link key={c.id} to={`/topluluk/${c.id}`} style={{ color: "inherit" }}>
              <div className="card">
                <div className="row between" style={{ marginBottom: 6 }}>
                  <span className="tag tag-blue">{scopeLabel[c.scope]}</span>
                  <div className="row" style={{ gap: 8 }}>
                    {canModerate(user, c.created_by) && (
                      <button
                        className="btn btn-ghost"
                        style={{ padding: "2px 8px", fontSize: 12, color: "#ff6b6b" }}
                        onClick={(e) => remove(e, c)}
                      >
                        Sil
                      </button>
                    )}
                    <span className="tag">Aç →</span>
                  </div>
                </div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 20 }}>{c.name}</div>
                <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
                  {c.post_count ?? 0} gönderi
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateCommunity({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [scope, setScope] = useState<CommunityScope>("general");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api("/communities", { method: "POST", body: { name, scope } });
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Oluşturulamadı.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 18, maxWidth: 520 }}>
      <h3 style={{ fontSize: 15 }}>Yeni topluluk</h3>
      <form onSubmit={submit}>
        <div className="field">
          <label>Topluluk adı</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Web Programlama Yardımlaşma" required />
        </div>
        <div className="field">
          <label>Kapsam</label>
          <select value={scope} onChange={(e) => setScope(e.target.value as CommunityScope)}>
            <option value="general">Genel</option>
            <option value="class">Sınıf</option>
            <option value="department">Bölüm</option>
          </select>
        </div>
        {err && <p className="error">{err}</p>}
        <button className="btn btn-primary" disabled={busy || !name.trim()}>
          {busy ? "…" : "Oluştur"}
        </button>
      </form>
    </div>
  );
}
