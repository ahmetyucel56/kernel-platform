import { useEffect, useRef, useState } from "react";
import { api, apiUpload, ApiError } from "../../api/client";
import type { PrecheckResult, PrecheckStatus, ReqStatus } from "../../api/types";
import { formatDate } from "../../lib/format";
import { IconSparkle } from "../icons";

const OK = "#4ec9b0";
const BAD = "#ff6b6b";
const REQ_LABEL: Record<ReqStatus, string> = { met: "Tam", partial: "Kısmen", missing: "Eksik" };
const REQ_COLOR: Record<ReqStatus, string> = { met: OK, partial: "var(--gold)", missing: BAD };

/** Teslim öncesi ön kontrol: akademisyen ödevde açtıysa görünür. Teslim oluşturmaz. */
export function PrecheckPanel({ assignmentId }: { assignmentId: string }) {
  const [st, setSt] = useState<PrecheckStatus | null>(null);
  const [result, setResult] = useState<PrecheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<PrecheckStatus>(`/assignments/${assignmentId}/precheck`)
      .then((s) => {
        setSt(s);
        setResult(s.history[0] ?? null);
      })
      .catch(() => {});
  }, [assignmentId]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setErr(null);
    if (!f.name.toLowerCase().endsWith(".zip")) {
      setErr("Yalnızca .zip dosyası yükleyebilirsin.");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", f);
      const res = await apiUpload<{ result: PrecheckResult; status: PrecheckStatus }>(
        `/assignments/${assignmentId}/precheck`,
        form
      );
      setResult(res.result);
      setSt(res.status);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Ön kontrol yapılamadı.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  if (!st || !st.enabled) return null;
  const canRun = st.available && st.remaining > 0 && !busy;
  const cov = result?.coverage ?? null;

  return (
    <div className="panel" style={{ padding: 12, marginTop: 12 }}>
      <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}>
        <div>
          <div className="row" style={{ fontWeight: 600, fontSize: 14, gap: 6 }}>
            <span style={{ color: "var(--gold)", display: "inline-flex" }}><IconSparkle size={15} /></span>
            Teslim öncesi ön kontrol
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            Kodunu kurallara göre kontrol et; bu bir teslim değildir, notlanmaz.
          </div>
        </div>
        <label
          className="btn"
          style={{ cursor: canRun ? "pointer" : "default", opacity: canRun ? 1 : 0.55, padding: "6px 12px", fontSize: 13 }}
        >
          {busy ? "Kontrol ediliyor…" : "ZIP ile kontrol et"}
          <input ref={fileRef} type="file" accept=".zip" onChange={onFile} disabled={!canRun} style={{ display: "none" }} />
        </label>
      </div>
      <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>
        {st.available
          ? st.remaining > 0
            ? `Kalan hak: ${st.remaining}/${st.limit} (24 saatte)`
            : `Hakkın doldu${st.resets_at ? ` · ${formatDate(st.resets_at)} itibarıyla yeni hak` : ""}`
          : st.reason}
      </div>
      {err && <p className="error">{err}</p>}

      {result && (
        <div style={{ marginTop: 12 }}>
          <div className="row between" style={{ flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            <span style={{ fontSize: 13 }}>
              <b style={{ fontSize: 18, color: cov == null ? "inherit" : cov >= 75 ? OK : cov >= 50 ? "var(--gold)" : BAD }}>
                %{cov ?? "—"}
              </b>{" "}
              kapsam · {result.met} tam · {result.partial} kısmen · {result.missing} eksik
            </span>
            <span className="faint" style={{ fontSize: 12 }}>{formatDate(result.created_at)}</span>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            {result.items.map((it, i) => (
              <div key={i} style={{ borderTop: "1px solid var(--line)", paddingTop: 6 }}>
                <div className="row between" style={{ gap: 8, alignItems: "flex-start" }}>
                  <span style={{ fontSize: 13 }}>{it.requirement}</span>
                  <span className="tag" style={{ color: REQ_COLOR[it.status], borderColor: REQ_COLOR[it.status], flexShrink: 0 }}>
                    {REQ_LABEL[it.status]}
                  </span>
                </div>
                {it.status !== "met" && it.evidence && (
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{it.evidence}</div>
                )}
              </div>
            ))}
          </div>
          {result.missing + result.partial === 0 && (
            <p className="ok" style={{ marginBottom: 0 }}>Tüm kurallar karşılanıyor görünüyor — teslim etmeye hazırsın.</p>
          )}
        </div>
      )}
    </div>
  );
}
