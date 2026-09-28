import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { API_BASE_URL } from "../config";
import { IconAlert, IconDownload } from "../components/icons";
import { PLAGIARISM_WARN } from "../lib/grade";
import type {
  Analysis,
  Assignment,
  Comment,
  Diff,
  FileContent,
  FileTreeNode,
  Submission,
  SubmissionListItem,
} from "../api/types";
import { CodeView } from "../components/code/CodeView";
import { FileTree } from "../components/code/FileTree";
import { DiffView } from "../components/code/DiffView";
import { FilePreview } from "../components/code/FilePreview";
import { ReviewPanel } from "../components/review/ReviewPanel";
import { useAuth } from "../auth/AuthContext";
import { formatDate } from "../lib/format";

function firstFilePath(node: FileTreeNode | null): string | null {
  if (!node?.children) return null;
  const vals = Object.values(node.children).sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const c of vals) {
    if (c.type === "file" && c.path) return c.path;
    const nested = firstFilePath(c);
    if (nested) return nested;
  }
  return null;
}

export function SubmissionViewer() {
  const { submissionId = "" } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canReview = user?.role === "academician" || user?.role === "admin";

  const [currentId, setCurrentId] = useState(submissionId);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [versions, setVersions] = useState<SubmissionListItem[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [diffMode, setDiffMode] = useState(false);
  const [fileContent, setFileContent] = useState<FileContent | null>(null);
  const [diff, setDiff] = useState<Diff | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [lineComposer, setLineComposer] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => setCurrentId(submissionId), [submissionId]);

  function reloadComments(id = currentId) {
    if (!id) return;
    api<Comment[]>(`/submissions/${id}/comments`).then(setComments).catch(() => {});
  }

  // Gonderim metasi + versiyon listesi + yorumlar
  useEffect(() => {
    if (!currentId) return;
    setErr(null);
    setLineComposer(null);
    reloadComments(currentId);
    api<Submission>(`/submissions/${currentId}`)
      .then((sub) => {
        setSubmission(sub);
        setSelectedPath(firstFilePath(sub.file_tree_json));
        return api<SubmissionListItem[]>(
          `/assignments/${sub.assignment_id}/submissions?student_id=${sub.student_id}`
        ).then(setVersions);
      })
      .catch((e) => setErr(e instanceof ApiError ? e.message : "Yüklenemedi."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  // Secili dosya icerigi veya diff
  useEffect(() => {
    setLineComposer(null);
    if (!currentId || !selectedPath) {
      setFileContent(null);
      setDiff(null);
      return;
    }
    if (diffMode) {
      api<Diff>(`/submissions/${currentId}/diff?path=${encodeURIComponent(selectedPath)}`)
        .then(setDiff)
        .catch((e) => setErr(e instanceof ApiError ? e.message : "Diff alınamadı."));
    } else {
      api<FileContent>(`/submissions/${currentId}/file?path=${encodeURIComponent(selectedPath)}`)
        .then(setFileContent)
        .catch((e) => setErr(e instanceof ApiError ? e.message : "Dosya alınamadı."));
    }
  }, [currentId, selectedPath, diffMode]);

  const currentVersion = useMemo(
    () => versions.find((v) => v.id === currentId)?.version_number ?? submission?.version_number,
    [versions, currentId, submission]
  );

  // ZIP indirme: kisa omurlu imzali link alinir, tarayici indirir (token URL'de,
  // 5 dk ve yalnizca bu surum icin gecerli; oturum token'i URL'ye konmaz).
  const [downloading, setDownloading] = useState(false);
  async function downloadZip() {
    setDownloading(true);
    setErr(null);
    try {
      const { url } = await api<{ url: string }>(`/submissions/${currentId}/download-link`, {
        method: "POST",
      });
      window.location.assign(`${API_BASE_URL}${url}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "İndirme başlatılamadı.");
    } finally {
      setDownloading(false);
    }
  }

  // Hoca: ödev ayarına göre öğrencinin görmediği AI sonuç türleri (kartlarda gösterilir)
  const [hiddenFromStudent, setHiddenFromStudent] = useState<string[] | undefined>(undefined);
  const [isDocument, setIsDocument] = useState(false);
  useEffect(() => {
    if (!canReview || !submission?.assignment_id) return;
    api<Assignment>(`/assignments/${submission.assignment_id}`)
      .then((a) => {
        setIsDocument(a.submission_kind === "document");
        setHiddenFromStudent([
          "plagiarism",
          ...(a.show_requirement_to_student === false ? ["requirement_check"] : []),
          ...(a.show_clean_code_to_student === false ? ["clean_code"] : []),
        ]);
      })
      .catch(() => {});
  }, [canReview, submission?.assignment_id]);

  // Yüksek benzerlik uyarısı (hoca; en son intihal analizinden)
  const [similar, setSimilar] = useState<{ pct: number; name: string | null } | null>(null);
  useEffect(() => {
    setSimilar(null);
    if (!canReview || !currentId) return;
    api<Analysis[]>(`/submissions/${currentId}/analyses`)
      .then((list) => {
        const pl = list.find((a) => a.analysis_type === "plagiarism");
        const top = pl?.summary_json?.top_similarity;
        if (typeof top === "number" && top >= PLAGIARISM_WARN)
          setSimilar({ pct: top, name: pl?.detail_json?.matches?.[0]?.student_name ?? null });
      })
      .catch(() => {});
  }, [currentId, canReview]);

  // Secili dosyaya ait satir yorumlari
  const lineComments = useMemo(
    () => comments.filter((c) => c.file_path === selectedPath && c.line_number != null),
    [comments, selectedPath]
  );
  const commentedLines = useMemo(
    () => new Set(lineComments.map((c) => c.line_number as number)),
    [lineComments]
  );

  return (
    <div style={{ paddingBottom: 24 }}>
      <button className="btn btn-ghost" onClick={() => navigate(-1)} style={{ marginBottom: 12 }}>
        ← Geri
      </button>

      {err && <p className="error">{err}</p>}

      <div className="row between" style={{ marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 24, margin: 0 }}>
            {canReview && submission?.student_name ? submission.student_name : "Gönderim"}{" "}
            <span className="accent">v{currentVersion ?? "?"}</span>
          </h1>
          {submission?.assignment_title && (
            <div className="muted" style={{ fontSize: 13 }}>{submission.assignment_title}</div>
          )}
        </div>
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <label style={{ margin: 0 }}>Sürüm:</label>
          <select value={currentId} onChange={(e) => setCurrentId(e.target.value)} style={{ width: "auto" }}>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.version_number} · {formatDate(v.submitted_at)}
              </option>
            ))}
          </select>
          <button
            className={diffMode ? "btn btn-gold" : "btn"}
            onClick={() => setDiffMode((d) => !d)}
            title="Bir önceki sürümle farkı göster"
          >
            {diffMode ? "Diff açık" : "Diff"}
          </button>
          <button
            className="btn"
            onClick={downloadZip}
            disabled={downloading || !currentId}
            title="Bu sürümün projesini ZIP olarak indir (bilgisayarında çalıştırmak için)"
          >
            <IconDownload />
            {downloading ? "Hazırlanıyor…" : "Projeyi indir"}
          </button>
        </div>
      </div>

      {canReview && similar && (
        <div className="banner banner-danger" style={{ marginBottom: 14 }}>
          <span style={{ color: "var(--danger)", display: "inline-flex", marginTop: 2 }}>
            <IconAlert />
          </span>
          <div>
            <b>
              {similar.name ? `${similar.name} ile ` : ""}%{similar.pct} benzerlik.
            </b>{" "}
            <span className="muted">Notlamadan önce iki teslimi karşılaştır (AI analizi → İntihal ayrıntısı).</span>
          </div>
        </div>
      )}

      <div className="cols-sidebar">
        <div className="card" style={{ padding: 12, maxHeight: "70vh", overflow: "auto" }}>
          {submission?.file_tree_json ? (
            <FileTree node={submission.file_tree_json} selected={selectedPath} onSelect={setSelectedPath} />
          ) : (
            <span className="muted">Dosya yok.</span>
          )}
        </div>

        <div>
          {selectedPath && (
            <div className="row between" style={{ marginBottom: 6, flexWrap: "wrap", gap: 6 }}>
              <span className="muted" style={{ fontSize: 13 }}>{selectedPath}</span>
              {!diffMode && fileContent && !fileContent.is_binary && (
                <span className="faint" style={{ fontSize: 12 }}>
                  {canReview ? "Yorum için bir satıra tıkla" : "Yorumlu satıra tıklayarak gör"}
                </span>
              )}
            </div>
          )}
          {diffMode ? (
            diff ? <DiffView diff={diff} /> : <span className="muted">Diff yükleniyor…</span>
          ) : fileContent ? (
            fileContent.is_binary ? (
              <div className="stack" style={{ gap: 8 }}>
                {fileContent.has_text && (
                  <div className="faint" style={{ fontSize: 12 }}>Yapay zekâ bu belgenin metnini okuyabiliyor.</div>
                )}
                <FilePreview submissionId={currentId} path={fileContent.path} />
              </div>
            ) : fileContent.content === null ? (
              <div className="card"><span className="muted">Dosya çok büyük, içerik saklanmadı.</span></div>
            ) : (
              <CodeView
                path={fileContent.path}
                content={fileContent.content}
                onLineClick={(ln) => setLineComposer((cur) => (cur === ln ? null : ln))}
                commentedLines={commentedLines}
                activeLine={lineComposer}
              />
            )
          ) : (
            <span className="muted">Bir dosya seç.</span>
          )}

          {lineComposer !== null && selectedPath && (
            <LineThread
              submissionId={currentId}
              path={selectedPath}
              line={lineComposer}
              comments={lineComments.filter((c) => c.line_number === lineComposer)}
              canReview={canReview}
              onPosted={() => reloadComments()}
              onClose={() => setLineComposer(null)}
            />
          )}

          {currentId && (
            <ReviewPanel
              hiddenFromStudent={hiddenFromStudent}
              document={isDocument}
              submissionId={currentId}
              selectedPath={selectedPath}
              canReview={canReview}
              comments={comments}
              onCommentsChanged={() => reloadComments()}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function LineThread({
  submissionId,
  path,
  line,
  comments,
  canReview,
  onPosted,
  onClose,
}: {
  submissionId: string;
  path: string;
  line: number;
  comments: Comment[];
  canReview: boolean;
  onPosted: () => void;
  onClose: () => void;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api(`/submissions/${submissionId}/comments`, {
        method: "POST",
        body: { body, file_path: path, line_number: line },
      });
      setBody("");
      onPosted();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Eklenemedi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 10, borderColor: "var(--gold-dim)" }}>
      <div className="row between">
        <span className="tag tag-gold">Satır {line}</span>
        <button className="btn btn-ghost" style={{ padding: "4px 10px" }} onClick={onClose}>
          Kapat
        </button>
      </div>
      <div className="stack" style={{ gap: 8, margin: "10px 0" }}>
        {comments.length === 0 && <span className="muted" style={{ fontSize: 13 }}>Bu satırda henüz yorum yok.</span>}
        {comments.map((c) => (
          <div key={c.id} className="panel" style={{ padding: 10 }}>
            <div className="faint" style={{ fontSize: 12, marginBottom: 3 }}>
              {c.author_name} · {formatDate(c.created_at)}
            </div>
            <div style={{ fontSize: 14, whiteSpace: "pre-wrap" }}>{c.body}</div>
          </div>
        ))}
      </div>
      {canReview && (
        <form onSubmit={submit}>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder={`Satır ${line} için yorum…`} required />
          {err && <p className="error">{err}</p>}
          <button className="btn btn-primary" disabled={busy || !body.trim()} style={{ marginTop: 8 }}>
            {busy ? "…" : "Satıra yorum ekle"}
          </button>
        </form>
      )}
    </div>
  );
}
