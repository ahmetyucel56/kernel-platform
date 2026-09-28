import { useEffect, useState } from "react";
import { api, ApiError } from "../../api/client";
import type { Analysis, AnalysisType } from "../../api/types";
import { formatDate } from "../../lib/format";
import { PLAGIARISM_WARN } from "../../lib/grade";

const TYPES: { key: AnalysisType; label: string }[] = [
  { key: "clean_code", label: "Clean Code" },
  { key: "requirement_check", label: "Gereksinim Kontrolü" },
  { key: "plagiarism", label: "İntihal / Benzerlik" },
];

const TYPE_LABEL: Record<AnalysisType, string> = {
  clean_code: "Clean Code",
  requirement_check: "Gereksinim Kontrolü",
  plagiarism: "İntihal / Benzerlik",
  readme_draft: "README Taslağı",
};

/** AI Analiz Motoru. Akademisyen tetikler (spec Bolum 7); ogrenci salt-okunur
 *  gorur (kendi gonderiminde uretilmis analizler, intihal haric). */
export function AiAnalysisPanel({
  submissionId,
  readOnly = false,
  onAnalyzed,
  hiddenFromStudent,
}: {
  submissionId: string;
  readOnly?: boolean;
  /** Hoca görünümü: ödev ayarına göre öğrencinin görmediği analiz türleri */
  hiddenFromStudent?: string[];
  /** Yeni analiz tamamlanınca (ör. not önerisini tazelemek için) */
  onAnalyzed?: () => void;
}) {
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [busy, setBusy] = useState<AnalysisType | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function refresh() {
    api<Analysis[]>(`/submissions/${submissionId}/analyses`).then(setAnalyses).catch(() => {});
  }
  useEffect(refresh, [submissionId]);

  async function run(type: AnalysisType) {
    setErr(null);
    setBusy(type);
    try {
      await api<Analysis>(`/submissions/${submissionId}/analyze`, {
        method: "POST",
        body: { analysis_type: type },
      });
      refresh();
      onAnalyzed?.();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Analiz başarısız.");
    } finally {
      setBusy(null);
    }
  }

  // Ogrenci gorunumunde hic analiz yoksa paneli hic gosterme (gurultu olmasin)
  if (readOnly && analyses.length === 0) return null;

  return (
    <div className="card" style={{ marginTop: 18, borderColor: "var(--blue-soft)" }}>
      <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ fontSize: 16, margin: 0 }}>
          <span className="accent" style={{ fontStyle: "normal", color: "var(--blue-soft)" }}>
            AI
          </span>{" "}
          {readOnly ? "Geri Bildirim" : "Analiz Motoru"}
        </h3>
        <span className="tag tag-blue">Senior Dev</span>
      </div>
      {readOnly ? (
        <p className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
          Akademisyenin senin için ürettiği yapay zeka değerlendirmesi:
        </p>
      ) : (
        <>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
            Yapay zeka yalnızca sen tetiklediğinde çalışır. Bir analiz seç:
          </p>
          <div className="row" style={{ flexWrap: "wrap", gap: 8, marginTop: 6 }}>
            {TYPES.map((t) => (
              <button key={t.key} className="btn" onClick={() => run(t.key)} disabled={busy !== null}>
                {busy === t.key ? "Analiz ediliyor…" : t.label}
              </button>
            ))}
          </div>
        </>
      )}
      {err && <p className="error">{err}</p>}

      {analyses.length > 0 && (
        <div className="stack" style={{ gap: 10, marginTop: 14 }}>
          {groupByType(analyses).map((runs) => (
            <AnalysisGroup
              key={runs[0].id}
              runs={runs}
              studentSees={
                readOnly || !hiddenFromStudent ? undefined : !hiddenFromStudent.includes(runs[0].analysis_type)
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Analizler en yeni önce gelir; türe göre grupla (grup sırası = en yeni çalıştırma). */
function groupByType(list: Analysis[]): Analysis[][] {
  const groups = new Map<string, Analysis[]>();
  for (const a of list) {
    const g = groups.get(a.analysis_type);
    if (g) g.push(a);
    else groups.set(a.analysis_type, [a]);
  }
  return [...groups.values()];
}

/** Aynı türden birden çok çalıştırma: en yenisi "Güncel", eskiler kapalı bir listede. */
function AnalysisGroup({ runs, studentSees }: { runs: Analysis[]; studentSees?: boolean }) {
  const [showOld, setShowOld] = useState(false);
  const [latest, ...older] = runs;
  return (
    <div>
      <AnalysisCard a={latest} studentSees={studentSees} badge={older.length ? "current" : undefined} />
      {older.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowOld((o) => !o)}>
            {showOld ? "Önceki çalıştırmaları gizle" : `Önceki çalıştırmalar (${older.length})`}
          </button>
          {showOld && (
            <div className="stack" style={{ gap: 8, marginTop: 8, opacity: 0.8 }}>
              <p className="faint" style={{ fontSize: 12, margin: 0 }}>
                Yapay zeka aynı kodu her çalıştırmada birebir aynı yorumlamayabilir. Özetlerde ve not
                önerisinde güncel sonuç kullanılır.
              </p>
              {older.map((a) => (
                <AnalysisCard key={a.id} a={a} badge="old" />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AnalysisCard({
  a,
  studentSees,
  badge,
}: {
  a: Analysis;
  studentSees?: boolean;
  badge?: "current" | "old";
}) {
  const [open, setOpen] = useState(false);
  const s = a.summary_json || {};
  return (
    <div className="panel" style={{ padding: 12 }}>
      <div className="row between" style={{ flexWrap: "wrap", gap: 6 }}>
        <span className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <span className="tag tag-blue">{TYPE_LABEL[a.analysis_type] ?? a.analysis_type}</span>
          {badge === "current" && <span className="chip chip-blue">Güncel</span>}
          {badge === "old" && <span className="chip">Önceki çalıştırma</span>}
          {studentSees !== undefined && (
            <span className={studentSees ? "chip chip-ok" : "chip"} title="Ödev ayarından değiştirilebilir">
              {studentSees ? "Öğrenci görüyor" : "Öğrenciden gizli"}
            </span>
          )}
        </span>
        <span className="faint" style={{ fontSize: 12 }}>{formatDate(a.created_at)}</span>
      </div>
      <div style={{ fontSize: 14, marginTop: 8 }}>{s.headline}</div>
      <MetricRow type={a.analysis_type} s={s} />
      <button className="btn btn-ghost" style={{ marginTop: 8, padding: "6px 12px" }} onClick={() => setOpen((o) => !o)}>
        {open ? "Detayları gizle" : "Detayları gör"}
      </button>
      {open && <AnalysisDetail a={a} />}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function MetricRow({ type, s }: { type: AnalysisType; s: Record<string, any> }) {
  if (type === "clean_code")
    return (
      <div className="row" style={{ gap: 10, marginTop: 6 }}>
        <span className="tag tag-gold" style={{ fontSize: 14 }}>Skor: <b>{s.score}</b>/100</span>
        <span className="muted" style={{ fontSize: 12 }}>{s.issues_count} bulgu</span>
      </div>
    );
  if (type === "requirement_check")
    return (
      <div className="row" style={{ gap: 10, marginTop: 6, flexWrap: "wrap" }}>
        <span className="tag tag-gold" style={{ fontSize: 14 }}>Kapsam: <b>%{s.coverage}</b></span>
        <span className="muted" style={{ fontSize: 12 }}>
          {s.met_count} tam
          {s.partial_count ? ` · ${s.partial_count} kısmen` : ""} · {s.missing_count} eksik
        </span>
      </div>
    );
  if (type === "plagiarism") {
    // Tek eşik (backend SIMILARITY_WARN ile aynı); eski "şüpheli" kayıtlar da tutarlı görünür
    const high = typeof s.top_similarity === "number" && s.top_similarity >= PLAGIARISM_WARN;
    const color = high ? "var(--danger)" : "var(--ok)";
    return (
      <div className="row" style={{ gap: 10, marginTop: 6 }}>
        <span className="tag" style={{ color, borderColor: color, fontSize: 13 }}>
          {high ? "Yüksek benzerlik" : s.match_count > 0 ? "Eşik altında" : "Temiz"}
        </span>
        {s.match_count > 0 && <span className="muted" style={{ fontSize: 12 }}>En yüksek: %{s.top_similarity}</span>}
      </div>
    );
  }
  return null;
}

function AnalysisDetail({ a }: { a: Analysis }) {
  const d = a.detail_json || {};
  const box: React.CSSProperties = { marginTop: 10, fontSize: 13 };

  if (a.analysis_type === "clean_code")
    return (
      <div style={box}>
        {d.strengths?.length > 0 && (
          <>
            <div className="ok" style={{ marginBottom: 4 }}>Güçlü yönler</div>
            <ul style={{ margin: "0 0 10px", paddingLeft: 18 }}>
              {d.strengths.map((x: string, i: number) => <li key={i} className="muted">{x}</li>)}
            </ul>
          </>
        )}
        {d.issues?.length > 0 && (
          <>
            <div className="error" style={{ marginBottom: 4 }}>Bulgular</div>
            <div className="stack" style={{ gap: 6 }}>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {d.issues.map((it: any, i: number) => (
                <div key={i} style={{ borderLeft: "3px solid var(--gold-dim)", paddingLeft: 8 }}>
                  <b>{it.title}</b> <span className="faint">({it.severity})</span>
                  <div className="muted">{it.detail}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );

  if (a.analysis_type === "requirement_check") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const line = (m: any, i: number) => (
      <li key={i} className="muted" style={{ marginBottom: 4 }}>
        <b style={{ color: "var(--ink)" }}>{m.requirement}</b>
        {(m.evidence || m.note) && <> — {m.evidence || m.note}</>}
        {m.where && <span className="faint" style={{ fontSize: 12 }}> ({m.where})</span>}
      </li>
    );
    return (
      <div style={box}>
        {d.met?.length > 0 && (
          <>
            <div className="ok" style={{ marginBottom: 4 }}>✓ Tam karşılanan ({d.met.length})</div>
            <ul style={{ margin: "0 0 10px", paddingLeft: 18 }}>{d.met.map(line)}</ul>
          </>
        )}
        {d.partial?.length > 0 && (
          <>
            <div style={{ marginBottom: 4, color: "var(--gold)" }}>◑ Kısmen / eksik ({d.partial.length})</div>
            <ul style={{ margin: "0 0 10px", paddingLeft: 18 }}>{d.partial.map(line)}</ul>
          </>
        )}
        {d.missing?.length > 0 && (
          <>
            <div className="error" style={{ marginBottom: 4 }}>✗ Yok ({d.missing.length})</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>{d.missing.map(line)}</ul>
          </>
        )}
        {d.note && <div className="faint" style={{ marginTop: 8, fontSize: 12 }}>{d.note}</div>}
      </div>
    );
  }

  if (a.analysis_type === "plagiarism")
    return (
      <div style={box}>
        {d.matches?.length > 0 ? (
          <div className="stack" style={{ gap: 6 }}>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {d.matches.map((m: any, i: number) => (
              <div key={i} className="row between" style={{ borderBottom: "1px solid var(--line)", paddingBottom: 6 }}>
                <span>{m.student_name}</span>
                <span className="tag tag-gold">%{m.similarity}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="muted">Kayda değer benzerlik yok.</div>
        )}
        <div className="faint" style={{ marginTop: 8, fontSize: 12 }}>{d.note}</div>
      </div>
    );

  if (a.analysis_type === "readme_draft")
    return (
      <pre
        style={{
          marginTop: 10,
          padding: 12,
          background: "#1e1e1e",
          color: "#d4d4d4",
          borderRadius: 8,
          fontSize: 12.5,
          whiteSpace: "pre-wrap",
          maxHeight: "40vh",
          overflow: "auto",
        }}
      >
        {d.markdown}
      </pre>
    );

  return null;
}
