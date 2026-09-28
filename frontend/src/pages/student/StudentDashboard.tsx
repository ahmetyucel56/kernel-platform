import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import type { Badge, MeSummary, MyAssignment, Progress } from "../../api/types";
import { useAuth } from "../../auth/AuthContext";
import { ProgressChart } from "../../components/gamify/ProgressChart";
import { BadgesRow } from "../../components/gamify/BadgesRow";
import { IconChevronRight, IconSparkle, IconUpload } from "../../components/icons";
import { firstName, formatDate, timeLeft } from "../../lib/format";

export function StudentDashboard() {
  const { user } = useAuth();
  const [summary, setSummary] = useState<MeSummary | null>(null);
  const [items, setItems] = useState<MyAssignment[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [sum, mine, prog, bdg] = await Promise.all([
          api<MeSummary>("/me/summary"),
          api<MyAssignment[]>("/me/assignments"),
          api<Progress>("/me/progress"),
          api<Badge[]>("/me/badges"),
        ]);
        setSummary(sum);
        setItems(mine);
        setProgress(prog);
        setBadges(bdg);
      } catch {
        /* sessiz */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <span className="muted">Yükleniyor…</span>;

  const name = firstName(summary?.full_name ?? user?.full_name);
  // Sıradaki: önce hiç teslim edilmemiş açık ödev, sonra notlanmamış, sonra en yakın açık ödev
  const open = items.filter((a) => a.open);
  const next =
    open.find((a) => a.status === "none") ?? open.find((a) => a.status !== "graded") ?? open[0] ?? null;
  const others = items.filter((a) => a !== next);
  const scores = items.map((a) => a.score).filter((s): s is number => s != null);
  const avg = scores.length ? Math.round((scores.reduce((x, y) => x + y, 0) / scores.length) * 10) / 10 : null;

  return (
    <div style={{ paddingBottom: 24 }}>
      <h1 className="h-hero" style={{ fontSize: "clamp(28px, 4vw, 40px)", marginBottom: 2 }}>
        Hoş geldin, <span className="accent">{name}.</span>
      </h1>
      <p className="muted" style={{ marginTop: 0, marginBottom: 24 }}>
        {[summary?.class_label, summary?.university].filter(Boolean).join(" · ") || "—"}
      </p>

      <div className="cols-main">
        <div className="stack" style={{ gap: 18 }}>
          {next ? <NextCard a={next} /> : (
            <div className="card">
              <p className="muted" style={{ margin: 0 }}>Şu an açık ödevin yok.</p>
            </div>
          )}

          <section className="stack" style={{ gap: 10 }}>
            <h2 className="eyebrow" style={{ margin: 0 }}>Diğer ödevler</h2>
            {others.length === 0 ? (
              <p className="muted" style={{ fontSize: 13.5, margin: 0 }}>Başka ödev yok.</p>
            ) : (
              <div className="card" style={{ padding: "2px 18px" }}>
                {others.map((a, i) => (
                  <Link
                    key={a.id}
                    to={a.latest ? `/gonderim/${a.latest.id}` : `/odevlerim#odev-${a.id}`}
                    className="row between"
                    style={{ color: "inherit", padding: "13px 0", borderTop: i ? "1px solid var(--line)" : undefined }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14.5 }}>{a.title}</div>
                      <div className="muted" style={{ fontSize: 12.5 }}>
                        {a.latest ? `v${a.latest.version_number}` : "Teslim yok"} ·{" "}
                        {a.open ? `${timeLeft(a.effective_deadline_at)} kaldı` : "süre doldu"} · {a.course_name ?? a.class_name}
                      </div>
                    </div>
                    <StatusChip a={a} />
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="stack" style={{ gap: 18 }}>
          <div className="card">
            <div className="eyebrow">Not ortalaması</div>
            <div className="big-num" style={{ fontSize: 34, marginTop: 4 }}>
              {avg ?? "—"}
              {avg != null && <small> /100</small>}
            </div>
            <div className="muted" style={{ fontSize: 12.5 }}>
              {scores.length ? `${scores.length} notlanmış ödevden` : "Henüz not yok"}
            </div>
          </div>
          <div className="card">
            <div className="row between" style={{ alignItems: "baseline" }}>
              <div className="eyebrow">Clean Code gelişimi</div>
              <span className="muted" style={{ fontSize: 13 }}>
                ort. <b style={{ color: "var(--ink)" }}>{progress?.average ?? "—"}</b>
              </span>
            </div>
            <div style={{ marginTop: 14 }}>
              <ProgressChart points={progress?.points ?? []} />
            </div>
          </div>
          <div className="card">
            <div className="eyebrow">Rozetler</div>
            <div style={{ marginTop: 12 }}>
              {badges.length ? <BadgesRow badges={badges} /> : <span className="muted">—</span>}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function StatusChip({ a }: { a: MyAssignment }) {
  if (a.score != null && a.status === "graded") return <span className="chip chip-ok">{a.score}</span>;
  if (a.status === "new_version") return <span className="chip chip-blue">Yeni sürüm inceleniyor</span>;
  if (a.status === "ungraded") return <span className="chip chip-blue">İnceleniyor</span>;
  return a.open ? <span className="chip chip-gold">Teslim bekleniyor</span> : <span className="chip">Teslim yok</span>;
}

/** Sıradaki teslim: kalan süre, durum, ön kontrol hakkı ve tek tıkla yükleme. */
function NextCard({ a }: { a: MyAssignment }) {
  const left = timeLeft(a.effective_deadline_at);
  const extended = a.effective_deadline_at !== a.deadline_at;
  return (
    <section className="hero">
      <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}>
        <span className="eyebrow" style={{ color: "var(--gold)" }}>Sıradaki teslim</span>
        <StatusChip a={a} />
      </div>
      <h2 style={{ fontSize: 24, margin: "10px 0 2px" }}>{a.title}</h2>
      <div className="muted" style={{ fontSize: 13 }}>{[a.course_name, a.class_name].filter(Boolean).join(" · ")}</div>
      <div className="row" style={{ gap: 28, margin: "16px 0 18px", flexWrap: "wrap" }}>
        <div>
          <div className="big-num">{left}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            kaldı · {formatDate(a.effective_deadline_at)}
            {extended ? " (uzatıldı)" : ""}
          </div>
        </div>
        {a.latest && (
          <div>
            <div className="big-num">v{a.latest.version_number}</div>
            <div className="muted" style={{ fontSize: 12 }}>son yüklediğin sürüm</div>
          </div>
        )}
        {a.precheck && (
          <div>
            <div className="big-num">
              {a.precheck.remaining}
              <small>/{a.precheck.limit}</small>
            </div>
            <div className="muted" style={{ fontSize: 12 }}>ön kontrol hakkı (24 sa)</div>
          </div>
        )}
      </div>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <Link className="btn btn-gold" to={`/odevlerim#odev-${a.id}`}>
          <IconUpload />
          {a.latest ? "Yeni sürüm yükle" : "Ödevi yükle"}
        </Link>
        {a.precheck && (
          <Link className="btn" to={`/odevlerim#odev-${a.id}`}>
            <IconSparkle />
            Ön kontrol yap
          </Link>
        )}
        {a.latest && (
          <Link className="btn btn-ghost" to={`/gonderim/${a.latest.id}`}>
            Geri bildirimi gör
            <IconChevronRight className="icon" />
          </Link>
        )}
      </div>
    </section>
  );
}
