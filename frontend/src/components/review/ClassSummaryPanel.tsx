import { useEffect, useState } from "react";
import { api, ApiError } from "../../api/client";
import type { Analysis } from "../../api/types";
import { formatDate } from "../../lib/format";

/** Sınıfın kod kalitesi (Clean Code) raporu — AI özeti penceresinin "Kod kalitesi"
 *  sekmesi. Hoca tetikler; yalnızca en son rapor gösterilir. */
export function ClassSummaryPanel({ assignmentId }: { assignmentId: string }) {
  const [latest, setLatest] = useState<Analysis | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function refresh() {
    api<Analysis[]>(`/assignments/${assignmentId}/class-analyses`)
      .then((rows) => setLatest(rows[0] ?? null))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }
  useEffect(() => {
    setLatest(null);
    setLoaded(false);
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId]);

  async function run() {
    setErr(null);
    setBusy(true);
    try {
      setLatest(await api<Analysis>(`/assignments/${assignmentId}/analyze-class`, { method: "POST" }));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Rapor oluşturulamadı.");
    } finally {
      setBusy(false);
    }
  }

  const s = latest?.summary_json || {};
  const d = latest?.detail_json || {};

  return (
    <div>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Tüm teslimlerin kodunu birlikte değerlendirir: ortalama Clean Code, en sık yapılan hatalar ve
        tekrar anlatılması önerilen konular. Kurallardan bağımsızdır (kod okunabilirliği ve yapısı).
      </p>
      {err && <p className="error">{err}</p>}
      {loaded && !latest && <p className="muted" style={{ fontSize: 13 }}>Bu ödev için henüz kod kalitesi raporu yok.</p>}

      {latest && (
        <div className="panel" style={{ padding: 14, marginBottom: 12 }}>
          <div className="row between" style={{ flexWrap: "wrap", gap: 6 }}>
            <span className="row" style={{ gap: 10, alignItems: "baseline" }}>
              <span style={{ fontFamily: "var(--font-display)", fontSize: 30, fontWeight: 700 }}>
                {s.average}
                <span className="muted" style={{ fontSize: 14 }}>/100</span>
              </span>
              <span className="muted" style={{ fontSize: 13 }}>ortalama Clean Code · {s.student_count} öğrenci</span>
            </span>
            <span className="faint" style={{ fontSize: 12 }}>{formatDate(latest.created_at)}</span>
          </div>

          {d.topics?.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Tekrar anlatılması önerilen konular</div>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                {d.topics.map((t: string, i: number) => (
                  <span key={i} className="chip chip-gold">{t}</span>
                ))}
              </div>
            </div>
          )}

          {d.common_issues?.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>En sık yapılan hatalar</div>
              <div className="stack" style={{ gap: 4 }}>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {d.common_issues.map((it: any, i: number) => (
                  <div key={i} className="row between" style={{ fontSize: 13 }}>
                    <span className="muted">{it.title}</span>
                    <span className="chip">{it.count} öğrenci</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {d.per_student?.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Öğrenci puanları (düşükten yükseğe)</div>
              <div className="stack" style={{ gap: 4 }}>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {d.per_student.map((p: any, i: number) => (
                  <div key={i} className="row between" style={{ fontSize: 13, borderBottom: "1px solid var(--line)", paddingBottom: 4 }}>
                    <span>{p.student_name}</span>
                    <span className={p.score < 60 ? "error" : p.score >= 80 ? "ok" : "muted"}>{p.score}/100</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {d.note && <div className="faint" style={{ marginTop: 10, fontSize: 12 }}>{d.note}</div>}
        </div>
      )}

      <button className={latest ? "btn" : "btn btn-gold"} onClick={run} disabled={busy} style={{ width: "100%" }}>
        {busy ? "Rapor hazırlanıyor…" : latest ? "Raporu yenile" : "Kod kalitesi raporu çıkar"}
      </button>
    </div>
  );
}
