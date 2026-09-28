import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { formatDate } from "../lib/format";

interface NotificationItem {
  id: string;
  kind: string;
  message: string;
  submission_id: string | null;
  assignment_id: string | null;
  is_read: boolean;
  created_at: string;
}

const KIND_LABEL: Record<string, string> = {
  graded: "Not",
  comment: "Yorum",
  submission: "Gönderim",
  assignment: "Yeni ödev",
  reopen: "Uzatma",
};

export function Notifications() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const nav = useNavigate();

  function load() {
    api<NotificationItem[]>("/me/notifications")
      .then(setItems)
      .catch(() => {})
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function open(n: NotificationItem) {
    if (!n.is_read) {
      try {
        await api(`/me/notifications/${n.id}/read`, { method: "POST" });
      } catch {
        /* yut */
      }
    }
    if (n.submission_id) nav(`/gonderim/${n.submission_id}`);
    else if (n.assignment_id) nav("/odevlerim");
    else load();
  }

  async function markAll() {
    try {
      await api("/me/notifications/read-all", { method: "POST" });
    } catch {
      /* yut */
    }
    load();
  }

  const unread = items.filter((i) => !i.is_read).length;

  return (
    <div style={{ paddingBottom: 24 }}>
      <div className="row between" style={{ flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
        <h1 className="h-page" style={{ margin: 0 }}>
          Bildirimler {unread > 0 && <span className="accent">({unread})</span>}
        </h1>
        {unread > 0 && (
          <button className="btn" onClick={markAll}>
            Tümünü okundu işaretle
          </button>
        )}
      </div>

      {loading ? (
        <p className="muted">Yükleniyor…</p>
      ) : items.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>Henüz bildirimin yok.</p>
        </div>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          {items.map((n) => (
            <button
              key={n.id}
              onClick={() => open(n)}
              className="card"
              style={{
                textAlign: "left",
                cursor: "pointer",
                borderLeft: n.is_read ? "1px solid var(--line)" : "3px solid var(--gold)",
                background: n.is_read ? "var(--bg-2)" : "var(--bg-3)",
              }}
            >
              <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                <span className="tag tag-blue" style={{ fontSize: 11 }}>
                  {KIND_LABEL[n.kind] ?? n.kind}
                </span>
                <span className="faint" style={{ fontSize: 12, marginLeft: "auto" }}>
                  {formatDate(n.created_at)}
                </span>
              </div>
              <div style={{ fontSize: 14 }}>{n.message}</div>
              {n.submission_id && (
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  Görüntülemek için dokun →
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
