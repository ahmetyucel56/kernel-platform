import { useState } from "react";
import { api } from "../../api/client";

/** Reddit tarzı upvote (beğeni). Kendi sayacını yönetir; tıklayınca toggle. */
export function VoteButton({
  postId,
  votes,
  voted,
}: {
  postId: string;
  votes: number;
  voted: boolean;
}) {
  const [v, setV] = useState({ votes, voted });
  const [busy, setBusy] = useState(false);

  async function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      const r = await api<{ votes: number; voted: boolean }>(`/posts/${postId}/vote`, {
        method: "POST",
      });
      setV(r);
    } catch {
      /* yut */
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      className="btn btn-ghost"
      onClick={toggle}
      title={v.voted ? "Beğeniyi geri al" : "Beğen"}
      style={{
        padding: "2px 10px",
        fontSize: 13,
        whiteSpace: "nowrap",
        flexShrink: 0,
        color: v.voted ? "var(--gold)" : "var(--muted)",
        borderColor: v.voted ? "var(--gold-dim)" : "var(--line-2)",
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
      }}
    >
      ▲ {v.votes}
    </button>
  );
}
