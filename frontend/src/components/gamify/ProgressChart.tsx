import type { ProgressPoint } from "../../api/types";

/** Basit alan+cizgi grafigi (inline SVG, bagimliliksiz) — Clean Code trendi. */
export function ProgressChart({ points }: { points: ProgressPoint[] }) {
  if (points.length < 2)
    return (
      <div className="muted" style={{ padding: "30px 0", fontSize: 13 }}>
        Grafik için henüz yeterli veri yok. Ödev yükleyip analiz edildikçe burada
        gelişimin görünecek.
      </div>
    );

  const W = 600;
  const H = 150;
  const padY = 14;
  const scores = points.map((p) => p.score);
  const lo = Math.max(0, Math.min(...scores) - 4);
  const hi = Math.min(100, Math.max(...scores) + 4);
  const span = hi - lo || 1;

  const xy = points.map((p, i) => {
    const x = (i / (points.length - 1)) * W;
    const y = H - padY - ((p.score - lo) / span) * (H - padY * 2);
    return [x, y] as const;
  });

  const line = xy.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${W},${H} L0,${H} Z`;

  // Alt eksende az sayida etiket (ilk, orta, son -> "Şimdi")
  const labelIdx = [0, Math.floor((points.length - 1) / 2), points.length - 1];

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="auto" preserveAspectRatio="none"
           style={{ display: "block" }}>
        <defs>
          <linearGradient id="progFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--blue)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--blue)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#progFill)" />
        <path d={line} fill="none" stroke="var(--blue)" strokeWidth="2.5"
              strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {xy.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="2.5" fill="var(--blue)"
                  vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <div className="row between" style={{ marginTop: 8 }}>
        {labelIdx.map((idx, k) => (
          <span key={k} className="muted" style={{ fontSize: 12 }}>
            {k === labelIdx.length - 1 ? "Şimdi" : points[idx].label}
          </span>
        ))}
      </div>
    </div>
  );
}
