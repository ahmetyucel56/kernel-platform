import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../../api/client";
import type {
  ClassOverview,
  OverviewStudent,
  OverviewStudentStatus,
  ReqStatus,
} from "../../api/types";
import { formatDate } from "../../lib/format";
import { IconSparkle, IconX } from "../icons";
import { ClassSummaryPanel } from "./ClassSummaryPanel";

const OK = "#4ec9b0";
const BAD = "#ff6b6b";

const STATUS_LABEL: Record<OverviewStudentStatus, string> = {
  at_risk: "Riskli",
  late: "Teslim yok · süre doldu",
  pending: "Analiz bekliyor",
  no_submission: "Teslim yok",
  ok: "İyi",
};
const STATUS_COLOR: Record<OverviewStudentStatus, string> = {
  at_risk: BAD,
  late: BAD,
  pending: "var(--gold)",
  no_submission: "var(--faint)",
  ok: OK,
};
const statusLabel = (s: OverviewStudent) => (s.stale ? "Kurallar değişti" : STATUS_LABEL[s.status]);
const REQ_LABEL: Record<ReqStatus, string> = { met: "Tam", partial: "Kısmen", missing: "Eksik" };
const REQ_COLOR: Record<ReqStatus, string> = { met: OK, partial: "var(--gold)", missing: BAD };

/**
 * Sınıf AI özeti pop-it'i. Sınıf listesindeki "AI" butonu (sınıf özeti) veya
 * öğrenci satırındaki AI butonu (initialStudentId ile doğrudan öğrenci özeti) açar.
 */
export function ClassAiModal({
  classId,
  className,
  initialStudentId,
  onClose,
}: {
  classId: string;
  className: string;
  initialStudentId?: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<ClassOverview | null>(null);
  const [assignmentId, setAssignmentId] = useState<string | null>(null);
  const [tab, setTab] = useState<"class" | "student" | "code">(initialStudentId ? "student" : "class");
  const [studentId, setStudentId] = useState<string | null>(initialStudentId ?? null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setErr(null);
    const q = assignmentId ? `?assignment_id=${assignmentId}` : "";
    api<ClassOverview>(`/classes/${classId}/ai-overview${q}`)
      .then(setData)
      .catch((e) => setErr(e instanceof ApiError ? e.message : "Özet yüklenemedi."))
      .finally(() => setLoading(false));
  }, [classId, assignmentId]);

  // Esc ile kapat + arka plan kaydırmasını kilitle
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  async function analyzePending() {
    if (!data?.assignment) return;
    setAnalyzing(true);
    setErr(null);
    setInfo(null);
    try {
      const res = await api<ClassOverview>(`/classes/${classId}/ai-overview/analyze`, {
        method: "POST",
        body: { assignment_id: data.assignment.id },
      });
      setData(res);
      if (res.newly_analyzed) setInfo(`${res.newly_analyzed} teslim analiz edildi.`);
      else if (!res.failed) setInfo("Analiz bekleyen teslim yoktu.");
      if (res.failed)
        setErr(`${res.failed} teslim için yapay zekâ yanıt veremedi; sonuç kaydedilmedi. Biraz sonra tekrar dene.`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Analiz yapılamadı.");
    } finally {
      setAnalyzing(false);
    }
  }

  /** Eksik/kısmen kuralları öğrenci(ler)e yorum + bildirim olarak iletir.
   *  submissionId verilmezse: eksiği olan ve henüz bildirilmemiş herkese. */
  async function sendFeedback(submissionId?: string) {
    if (!data?.assignment) return;
    setSending(true);
    setErr(null);
    setInfo(null);
    try {
      const res = await api<ClassOverview>(`/classes/${classId}/ai-overview/send-feedback`, {
        method: "POST",
        body: {
          assignment_id: data.assignment.id,
          submission_ids: submissionId ? [submissionId] : null,
        },
      });
      setData(res);
      setInfo(
        res.feedback_sent
          ? `Eksikler ${res.feedback_sent} öğrenciye iletildi.`
          : "İletilecek yeni eksik yoktu."
      );
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Gönderilemedi.");
    } finally {
      setSending(false);
    }
  }

  const student = data?.students.find((s) => s.student_id === studentId) ?? null;
  const hasReqs = (data?.assignment?.requirements.length ?? 0) > 0;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${className} AI özeti`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="row" style={{ gap: 10, minWidth: 0 }}>
            <span
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                background: "rgba(216,178,115,.14)",
                color: "var(--gold)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <IconSparkle size={18} className="" />
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 700 }}>
                {className}
              </div>
              <div className="muted" style={{ fontSize: 12 }}>AI Özeti</div>
            </div>
          </div>
          <button className="btn btn-ghost icon-btn btn-icon-only" onClick={onClose} aria-label="Kapat">
            <IconX />
          </button>
        </div>

        <div className="modal-body">
          {data && data.assignments.length > 1 && (
            <div className="field" style={{ marginBottom: 12 }}>
              <select
                value={data.assignment?.id ?? ""}
                onChange={(e) => {
                  setAssignmentId(e.target.value);
                  setInfo(null);
                }}
                aria-label="Ödev seç"
              >
                {data.assignments.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.title} · {a.requirement_count} kural
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="seg" style={{ marginBottom: 14 }}>
            <button className={tab === "class" ? "on" : ""} onClick={() => setTab("class")}>
              Sınıf özeti
            </button>
            <button className={tab === "student" ? "on" : ""} onClick={() => setTab("student")}>
              Öğrenci özeti
            </button>
            <button className={tab === "code" ? "on" : ""} onClick={() => setTab("code")}>
              Kod kalitesi
            </button>
          </div>

          {loading && !data && <p className="muted">Yükleniyor…</p>}
          {err && <p className="error">{err}</p>}
          {info && <p className="ok">{info}</p>}

          {data && !data.assignment && (
            <p className="muted">Bu sınıfta henüz ödev yok. Ödev verince özet burada görünür.</p>
          )}

          {data?.assignment && tab === "code" && <ClassSummaryPanel assignmentId={data.assignment.id} />}

          {data?.assignment && !hasReqs && tab !== "code" && (
            <div className="panel" style={{ padding: 12, marginBottom: 12, fontSize: 13 }}>
              Bu ödevde gereksinim tanımlı değil. Kural bazlı kontrol için ödevi düzenleyip
              gereksinim ekle.
            </div>
          )}

          {data?.assignment && tab === "class" && (
            <ClassTab
              data={data}
              hasReqs={hasReqs}
              analyzing={analyzing}
              onAnalyze={analyzePending}
              sending={sending}
              onSendAll={() => sendFeedback()}
              onShowStudents={() => setTab("student")}
            />
          )}

          {data?.assignment && tab === "student" && (
            student ? (
              <StudentDetail
                s={student}
                hasReqs={hasReqs}
                analyzing={analyzing}
                onAnalyze={analyzePending}
                sending={sending}
                onSend={() => sendFeedback(student.submission_id!)}
                onBack={() => setStudentId(null)}
              />
            ) : (
              <StudentList students={data.students} onPick={setStudentId} />
            )
          )}
        </div>
      </div>
    </div>
  );
}

function ClassTab({
  data,
  hasReqs,
  analyzing,
  onAnalyze,
  sending,
  onSendAll,
  onShowStudents,
}: {
  data: ClassOverview;
  hasReqs: boolean;
  analyzing: boolean;
  onAnalyze: () => void;
  sending: boolean;
  onSendAll: () => void;
  onShowStudents: () => void;
}) {
  const cov = data.average_coverage;
  const covColor = cov == null ? "var(--muted)" : cov >= 75 ? OK : cov >= 50 ? "var(--gold)" : BAD;
  const flagged = data.requirements.filter((r) => r.missing + r.partial > 0);

  return (
    <>
      <div className="row" style={{ gap: 8, marginBottom: 14 }}>
        <div className="metric">
          <div className="k">Ort. kapsam</div>
          <div className="v" style={{ color: covColor }}>{cov == null ? "—" : `%${cov}`}</div>
        </div>
        <div className="metric">
          <div className="k">Teslim</div>
          <div className="v">
            {data.submitted_count}/{data.enrolled_count}
          </div>
        </div>
        <div className="metric">
          <div className="k">Riskli</div>
          <div className="v" style={{ color: data.at_risk_count ? BAD : "var(--ink)" }}>
            {data.at_risk_count}
          </div>
        </div>
      </div>

      <div style={{ fontSize: 14, marginBottom: 6 }}>{data.headline}</div>
      {data.insights.length > 0 && (
        <ul style={{ margin: "6px 0 14px", paddingLeft: 18, fontSize: 13.5, lineHeight: 1.6 }}>
          {data.insights.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      )}

      {data.recurring_topics.length > 0 && (
        <>
          <SectionLabel>Ödevler boyunca tekrar eden zayıflıklar</SectionLabel>
          <div className="stack" style={{ gap: 7, marginBottom: 14 }}>
            {data.recurring_topics.map((t) => (
              <div key={t.topic} className="list-row" style={{ alignItems: "flex-start" }}>
                <span style={{ fontSize: 13.5, display: "flex", alignItems: "baseline" }}>
                  <span className="dot" style={{ background: BAD }} />
                  {t.topic}
                </span>
                <span className="muted" style={{ fontSize: 12, textAlign: "right" }}>
                  {t.students.length} öğrenci: {t.students.slice(0, 3).join(", ")}
                  {t.students.length > 3 ? ` +${t.students.length - 3}` : ""}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {hasReqs && data.analyzed_count > 0 && (
        <>
          <SectionLabel>{flagged.length ? "En çok eksik kalan kurallar" : "Kurallar"}</SectionLabel>
          <div className="stack" style={{ gap: 7, marginBottom: 14 }}>
            {(flagged.length ? flagged : data.requirements).map((r) => (
              <div key={r.requirement} className="list-row" style={{ alignItems: "flex-start" }}>
                <span style={{ fontSize: 13.5, display: "flex", alignItems: "baseline" }}>
                  <span
                    className="dot"
                    style={{ background: r.missing ? BAD : r.partial ? "var(--gold)" : OK }}
                  />
                  {r.requirement}
                </span>
                <span className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                  {r.met} tam · {r.partial} kısmen · {r.missing} eksik
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        {hasReqs && data.pending_count > 0 && (
          <button className="btn btn-gold" onClick={onAnalyze} disabled={analyzing} style={{ flex: 1 }}>
            {analyzing
              ? "AI analiz ediyor…"
              : data.stale_count > 0
                ? `Yeniden analiz et (${data.pending_count})`
                : `Bekleyenleri analiz et (${data.pending_count})`}
          </button>
        )}
        {data.feedback_pending_count > 0 && (
          <button className="btn btn-primary" onClick={onSendAll} disabled={sending} style={{ flex: 1 }}>
            {sending ? "Gönderiliyor…" : `Eksikleri öğrencilere gönder (${data.feedback_pending_count})`}
          </button>
        )}
        <button className="btn" onClick={onShowStudents} style={{ flex: 1 }}>
          Öğrenci bazında gör
        </button>
      </div>
      {analyzing && (
        <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>
          Her teslimdeki kurallar tek tek kontrol ediliyor; öğrenci sayısına göre biraz sürebilir.
        </p>
      )}
    </>
  );
}

function StudentList({
  students,
  onPick,
}: {
  students: OverviewStudent[];
  onPick: (id: string) => void;
}) {
  if (students.length === 0) return <p className="muted">Bu sınıfta kayıtlı öğrenci yok.</p>;
  return (
    <div className="stack" style={{ gap: 7 }}>
      {students.map((s) => (
        <button key={s.student_id} className="list-row" onClick={() => onPick(s.student_id)}>
          <span style={{ display: "flex", alignItems: "center", fontSize: 14, minWidth: 0 }}>
            <span className="dot" style={{ background: STATUS_COLOR[s.status] }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {s.full_name}
            </span>
          </span>
          <span style={{ fontSize: 12.5, color: STATUS_COLOR[s.status], whiteSpace: "nowrap" }}>
            {s.trend && s.trend !== "flat" && (
              <span style={{ color: s.trend === "up" ? OK : BAD }} title={s.trend === "up" ? "Yükseliyor" : "Düşüyor"}>
                {s.trend === "up" ? "▲ " : "▼ "}
              </span>
            )}
            {s.coverage != null ? `%${s.coverage} kapsam` : statusLabel(s)}
            {s.feedback_sent_at ? " · iletildi" : ""} ›
          </span>
        </button>
      ))}
    </div>
  );
}

function StudentDetail({
  s,
  hasReqs,
  analyzing,
  onAnalyze,
  sending,
  onSend,
  onBack,
}: {
  s: OverviewStudent;
  hasReqs: boolean;
  analyzing: boolean;
  onAnalyze: () => void;
  sending: boolean;
  onSend: () => void;
  onBack: () => void;
}) {
  const hasGaps = s.analyzed && s.missing + s.partial > 0;
  return (
    <>
      <button className="btn btn-ghost" onClick={onBack} style={{ padding: "4px 10px", fontSize: 12, marginBottom: 10 }}>
        ← Tüm öğrenciler
      </button>
      <div className="row between" style={{ alignItems: "flex-start", marginBottom: 12 }}>
        <div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 700 }}>{s.full_name}</div>
          <div className="muted" style={{ fontSize: 12.5 }}>
            {s.school_no ? `No: ${s.school_no} · ` : ""}
            {s.submission_id
              ? `v${s.version} · ${formatDate(s.submitted_at!)}`
              : "Teslim yok"}
            {s.score != null ? ` · Not: ${s.score}` : ""}
            {s.precheck_count > 0 ? ` · ${s.precheck_count} ön kontrol` : ""}
          </div>
        </div>
        {s.coverage != null && (
          <div style={{ textAlign: "right" }}>
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 26,
                fontWeight: 700,
                color: s.coverage >= 75 ? OK : s.coverage >= 50 ? "var(--gold)" : BAD,
              }}
            >
              %{s.coverage}
            </div>
            <div className="muted" style={{ fontSize: 11.5 }}>
              {s.met} tam · {s.partial} kısmen · {s.missing} eksik
            </div>
          </div>
        )}
      </div>

      {!s.submission_id && <p className="muted">Bu öğrenci bu ödevi henüz teslim etmedi.</p>}

      {s.submission_id && !s.analyzed && (
        <div className="panel" style={{ padding: 12, fontSize: 13 }}>
          {s.stale
            ? "Bu teslimin analizi, ödevin kuralları değişmeden önce yapılmış; sonuç artık güncel değil."
            : "Bu teslim henüz AI ile analiz edilmedi."}
          {hasReqs && (
            <button className="btn btn-gold" onClick={onAnalyze} disabled={analyzing} style={{ marginTop: 10, width: "100%" }}>
              {analyzing ? "AI analiz ediyor…" : s.stale ? "Yeniden analiz et" : "Analiz bekleyenleri analiz et"}
            </button>
          )}
        </div>
      )}

      {hasGaps && (
        <div className="panel row between" style={{ padding: "10px 12px", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
          <span style={{ fontSize: 13 }}>
            {s.feedback_sent_at
              ? `✓ Eksikler ${formatDate(s.feedback_sent_at)} tarihinde öğrenciye iletildi.`
              : "Eksikler henüz öğrenciye iletilmedi."}
          </span>
          <button
            className={s.feedback_sent_at ? "btn btn-ghost" : "btn btn-primary"}
            onClick={onSend}
            disabled={sending}
            style={{ padding: "6px 12px", fontSize: 13 }}
          >
            {sending ? "Gönderiliyor…" : s.feedback_sent_at ? "Tekrar gönder" : "Eksikleri öğrenciye gönder"}
          </button>
        </div>
      )}

      {s.analyzed && (
        <div className="stack" style={{ gap: 7 }}>
          {s.items.map((it, i) => (
            <div key={i} className="panel" style={{ padding: "9px 12px" }}>
              <div className="row between" style={{ alignItems: "flex-start", gap: 10 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>{it.requirement}</span>
                <span
                  className="tag"
                  style={{ color: REQ_COLOR[it.status], borderColor: REQ_COLOR[it.status], flexShrink: 0 }}
                >
                  {REQ_LABEL[it.status]}
                </span>
              </div>
              {it.evidence && (
                <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>{it.evidence}</div>
              )}
              {it.where && (
                <div className="faint" style={{ fontSize: 12, marginTop: 2, fontFamily: "monospace" }}>
                  {it.where}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {s.submission_id && (
        <Link className="btn" to={`/gonderim/${s.submission_id}`} style={{ display: "block", textAlign: "center", marginTop: 12 }}>
          Teslimi aç →
        </Link>
      )}

      <Growth s={s} />
    </>
  );
}

/** Öğrencinin sınıftaki tüm ödevlerde kapsamı + tekrar eden zayıf konular. */
function Growth({ s }: { s: OverviewStudent }) {
  if (s.history.length < 2 && s.recurring.length === 0) return null;
  const color = (c: number) => (c >= 75 ? OK : c >= 50 ? "var(--gold)" : BAD);
  return (
    <div style={{ marginTop: 16 }}>
      <SectionLabel>Gelişim (ödevler boyunca)</SectionLabel>
      <div className="row" style={{ alignItems: "flex-end", gap: 6, height: 92, marginBottom: 6 }}>
        {s.history.map((p) => (
          <div
            key={p.assignment_id}
            title={`${p.title}: ${p.coverage != null ? `%${p.coverage}` : p.submitted ? "analiz yok" : "teslim yok"}`}
            style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}
          >
            <span className="faint" style={{ fontSize: 10.5 }}>
              {p.coverage != null ? `%${p.coverage}` : p.submitted ? "?" : "—"}
            </span>
            <div
              style={{
                width: "100%",
                maxWidth: 38,
                height: p.coverage != null ? Math.max(4, (p.coverage / 100) * 60) : 4,
                borderRadius: 4,
                background: p.coverage != null ? color(p.coverage) : "var(--line-2)",
              }}
            />
          </div>
        ))}
      </div>
      <div className="row" style={{ gap: 6 }}>
        {s.history.map((p) => (
          <span
            key={p.assignment_id}
            className="faint"
            style={{ flex: 1, minWidth: 0, fontSize: 10.5, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {p.title}
          </span>
        ))}
      </div>
      {s.trend && (
        <div style={{ fontSize: 13, marginTop: 8, color: s.trend === "up" ? OK : s.trend === "down" ? BAD : "var(--muted)" }}>
          {s.trend === "up" ? "▲ Son ödevde yükseliş var." : s.trend === "down" ? "▼ Son ödevde düşüş var." : "Son iki ödevde benzer seviyede."}
        </div>
      )}
      {s.recurring.length > 0 && (
        <div className="stack" style={{ gap: 6, marginTop: 10 }}>
          {s.recurring.map((r) => (
            <div key={r.topic} className="panel" style={{ padding: "8px 12px", fontSize: 13 }}>
              <b>{r.topic}</b>
              <span className="muted"> — {r.count}/{r.of} ödevde eksik veya kısmen</span>
              <div className="faint" style={{ fontSize: 12, marginTop: 2 }}>{r.assignments.join(" · ")}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="muted"
      style={{ fontSize: 11, letterSpacing: 1, textTransform: "uppercase", margin: "4px 0 8px" }}
    >
      {children}
    </div>
  );
}
