import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../../api/client";

/** Üst çubuktaki bildirim zili — okunmamış sayısını gösterir, /bildirimler'e götürür. */
export function NotificationBell() {
  const [count, setCount] = useState(0);
  const nav = useNavigate();
  const loc = useLocation();

  function refresh() {
    api<{ count: number }>("/me/notifications/unread-count")
      .then((r) => setCount(r.count))
      .catch(() => {});
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 45000);
    return () => clearInterval(t);
  }, []);

  // Sayfa değişince (özellikle /bildirimler'den çıkınca) sayacı tazele
  useEffect(refresh, [loc.pathname]);

  return (
    <button
      className="btn btn-ghost icon-btn"
      title="Bildirimler"
      aria-label="Bildirimler"
      onClick={() => nav("/bildirimler")}
      style={{ position: "relative" }}
    >
      <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.7}>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      {count > 0 && (
        <span
          style={{
            position: "absolute",
            top: 2,
            right: 2,
            minWidth: 16,
            height: 16,
            padding: "0 4px",
            borderRadius: 999,
            background: "var(--gold)",
            color: "#1a1408",
            fontSize: 10,
            fontWeight: 800,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            lineHeight: 1,
          }}
        >
          {count > 9 ? "9+" : count}
        </span>
      )}
    </button>
  );
}
