import { useEffect, useState } from "react";
import { api, ApiError } from "../../api/client";
import type { Analysis, Comment, Score } from "../../api/types";
import { formatDate } from "../../lib/format";
import { CLEAN_WEIGHT, COVERAGE_WEIGHT, gradeHint, PLAGIARISM_WARN, type GradeHint } from "../../lib/grade";
import { AiAnalysisPanel } from "./AiAnalysisPanel";
import { AiMentorChat } from "./AiMentorChat";
import { useAuth } from "../../auth/AuthContext";
import { IconAlert, IconFile } from "../icons";

/** Inceleme paneli: puan + serbest yorumlar (Sprint 2).
 *  canReview=true ise akademisyen not verir / yorum ekler; degilse salt-okunur. */
export function ReviewPanel({
  submissionId,
  selectedPath,
  canReview,
  comments,
  onCommentsChanged,
  hiddenFromStudent,
}: {
  submissionId: string;
  selectedPath: string | null;
  canReview: boolean;
  comments: Comment[];
  onCommentsChanged: () => void;
  hiddenFromStudent?: string[];
}) {
  const { user } = useAuth();
  const [score, setScore] = useState<Score | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [aiTick, setAiTick] = useState(0); // yeni AI analizi -> not önerisi tazelenir

  function refreshScore() {
    api<Score | null>(`/submissions/${submissionId}/score`).then(setScore).catch(() => {});
  }
  useEffect(refreshScore, [submissionId]);

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ fontSize: 16, margin: 0 }}>İnceleme</h3>
        <ScoreBadge score={score} />
      </div>

      {canReview && (
        <GradeForm submissionId={submissionId} current={score} onDone={refreshScore} aiTick={aiTick} />
      )}

      <hr />

      <h4 style={{ fontSize: 14, margin: "0 0 10px" }}>Yorumlar ({comments.length})</h4>
      {comments.length === 0 && <p className="muted" style={{ fontSize: 13 }}>Henüz yorum yok.</p>}
      <div className="stack" style={{ gap: 10 }}>
        {comments.map((c) => (
          <div key={c.id} className="panel" style={{ padding: 12 }}>
            <div className="row" style={{ gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
              <span className={c.author_type === "ai" ? "tag tag-blue" : "tag tag-gold"}>
                {c.author_type === "ai" ? "AI" : "Akademisyen"}
              </span>
              <span className="muted" style={{ fontSize: 12 }}>{c.author_name}</span>
              {c.file_path && (
                <span className="tag" style={{ fontSize: 11 }}>
                  <IconFile size={12} />
                  {c.file_path}
                  {c.line_number ? `:${c.line_number}` : ""}
                </span>
              )}
              <span className="faint" style={{ fontSize: 12, marginLeft: "auto" }}>
                {formatDate(c.created_at)}
              </span>
            </div>
            <div style={{ fontSize: 14, whiteSpace: "pre-wrap" }}>{c.body}</div>
          </div>
        ))}
      </div>

      {canReview && (
        <AddComment
          submissionId={submissionId}
          selectedPath={selectedPath}
          onDone={onCommentsChanged}
          onError={setErr}
        />
      )}
      {err && <p className="error">{err}</p>}

      {/* AI Analiz Motoru — akademisyen tetikler; ogrenci salt-okunur gorur */}
      {canReview && (
        <AiAnalysisPanel submissionId={submissionId} onAnalyzed={() => setAiTick((t) => t + 1)} hiddenFromStudent={hiddenFromStudent} />
      )}
      {user?.role === "student" && <AiAnalysisPanel submissionId={submissionId} readOnly />}

      {/* AI Mentor sohbeti — yalnizca gonderim sahibi ogrenci */}
      {user?.role === "student" && <AiMentorChat submissionId={submissionId} />}
    </div>
  );
}

function ScoreBadge({ score }: { score: Score | null }) {
  if (!score)
    return <span className="tag">Henüz notlanmadı</span>;
  return (
    <span className="tag tag-gold" style={{ fontSize: 14 }}>
      Not: <b style={{ marginLeft: 4 }}>{score.score}</b>/100
    </span>
  );
}

function GradeForm({
  submissionId,
  current,
  onDone,
  aiTick,
}: {
  submissionId: string;
  current: Score | null;
  onDone: () => void;
  aiTick: number;
}) {
  const [value, setValue] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hint, setHint] = useState<GradeHint | null>(null);

  useEffect(() => {
    api<Analysis[]>(`/submissions/${submissionId}/analyses`)
      .then((a) => setHint(gradeHint(a)))
      .catch(() => {});
  }, [submissionId, aiTick]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const num = Number(value);
    if (Number.isNaN(num) || num < 0 || num > 100) {
      setErr("0-100 arası bir not gir.");
      return;
    }
    setBusy(true);
    try {
      await api(`/submissions/${submissionId}/score`, { method: "POST", body: { score: num } });
      setValue("");
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Not verilemedi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    {hint && hint.suggested != null && (
      <div className="panel" style={{ padding: "10px 12px", marginTop: 12, fontSize: 13 }}>
        <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}>
          <span>
            <span className="muted">AI referansı: </span>
            {hint.coverage != null && <>gereksinim kapsamı <b>%{hint.coverage}</b></>}
            {hint.coverage != null && hint.cleanCode != null && " · "}
            {hint.cleanCode != null && <>Clean Code <b>{hint.cleanCode}</b>/100</>}
            {" → öneri "}
            <b style={{ color: "var(--gold)" }}>{hint.suggested}</b>
          </span>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: "4px 10px", fontSize: 12 }}
            onClick={() => setValue(String(hint.suggested))}
          >
            Öneriyi kullan
          </button>
        </div>
        <div className="faint" style={{ fontSize: 11.5, marginTop: 4 }}>
          {hint.coverage != null && hint.cleanCode != null
            ? `%${Math.round(COVERAGE_WEIGHT * 100)} kapsam + %${Math.round(CLEAN_WEIGHT * 100)} kod kalitesi. `
            : "Tek analize dayalı. "}
          Yalnızca referanstır; notu sen belirlersin.
        </div>
        {hint.similarity != null && hint.similarity >= PLAGIARISM_WARN && (
          <div className="error" style={{ marginTop: 6 }}>
            <IconAlert size={13} /> Başka bir teslimle %{hint.similarity} benzerlik var — notlamadan önce intihal sonucunu incele.
          </div>
        )}
      </div>
    )}
    <form onSubmit={submit} className="row" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
      <input
        type="number"
        min={0}
        max={100}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={current ? `${current.score}` : "0-100"}
        style={{ width: 120 }}
      />
      <button className="btn btn-gold" disabled={busy || value === ""}>
        {busy ? "…" : current ? "Notu güncelle" : "Not ver"}
      </button>
      {err && <span className="error">{err}</span>}
    </form>
    </>
  );
}

function AddComment({
  submissionId,
  selectedPath,
  onDone,
  onError,
}: {
  submissionId: string;
  selectedPath: string | null;
  onDone: () => void;
  onError: (m: string | null) => void;
}) {
  const [body, setBody] = useState("");
  const [attach, setAttach] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    onError(null);
    setBusy(true);
    try {
      await api(`/submissions/${submissionId}/comments`, {
        method: "POST",
        body: {
          body,
          file_path: attach && selectedPath ? selectedPath : null,
        },
      });
      setBody("");
      onDone();
    } catch (e) {
      onError(e instanceof ApiError ? e.message : "Yorum eklenemedi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 14 }}>
      <div className="field" style={{ marginBottom: 8 }}>
        <label>Yorum ekle</label>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} required />
      </div>
      <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}>
        <label
          style={{
            display: "flex",
            gap: 6,
            alignItems: "center",
            margin: 0,
            opacity: selectedPath ? 1 : 0.5,
          }}
        >
          <input
            type="checkbox"
            checked={attach}
            disabled={!selectedPath}
            onChange={(e) => setAttach(e.target.checked)}
            style={{ width: "auto" }}
          />
          Açık dosyaya iliştir{selectedPath ? ` (${selectedPath})` : ""}
        </label>
        <button className="btn btn-primary" disabled={busy || !body.trim()}>
          {busy ? "…" : "Gönder"}
        </button>
      </div>
    </form>
  );
}
