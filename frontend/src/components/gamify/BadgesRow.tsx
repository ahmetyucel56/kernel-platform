import type { Badge } from "../../api/types";

/** Rozetler — kazanilan (altin) / kilitli (gri ?) daireler. */
export function BadgesRow({ badges }: { badges: Badge[] }) {
  return (
    <div className="row" style={{ gap: 18, flexWrap: "wrap", alignItems: "flex-start" }}>
      {badges.map((b) => (
        <div key={b.code} style={{ textAlign: "center", width: 74 }} title={b.description}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: "50%",
              margin: "0 auto 8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: `2px solid ${b.earned ? "var(--gold)" : "var(--line-2)"}`,
              color: b.earned ? "var(--gold)" : "var(--faint)",
              fontFamily: "var(--font-display)",
              fontSize: 18,
              fontWeight: 700,
              background: b.earned ? "rgba(216,178,115,0.08)" : "transparent",
            }}
          >
            {b.earned ? b.value ?? "✓" : "?"}
          </div>
          <div
            style={{
              fontSize: 11,
              color: b.earned ? "var(--ink)" : "var(--faint)",
              lineHeight: 1.2,
            }}
          >
            {b.earned ? b.name : "Kilitli"}
          </div>
        </div>
      ))}
    </div>
  );
}
