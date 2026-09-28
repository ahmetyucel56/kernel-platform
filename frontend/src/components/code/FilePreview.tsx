import { useEffect, useState } from "react";
import { api, ApiError } from "../../api/client";
import type { DocBlock, DocRun, FilePreview as Preview } from "../../api/types";
import { API_BASE_URL } from "../../config";

/** Görsel / PDF / DOCX'i indirmeden gösterir. DOCX, sunucunun güvenli bloklarından çizilir
 *  (sayfaya HTML enjekte edilmez); görsel ve PDF sayfaları kısa ömürlü imzalı adreslerden gelir. */
export function FilePreview({ submissionId, path }: { submissionId: string; path: string }) {
  const [p, setP] = useState<Preview | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setP(null);
    setErr(null);
    api<Preview>(`/submissions/${submissionId}/preview?path=${encodeURIComponent(path)}`)
      .then(setP)
      .catch((e) => setErr(e instanceof ApiError ? e.message : "Önizleme yüklenemedi."));
  }, [submissionId, path]);

  if (err) return <div className="card"><span className="error">{err}</span></div>;
  if (!p) return <div className="card"><span className="muted">Önizleme hazırlanıyor…</span></div>;
  if (p.kind === "none") return <div className="card"><span className="muted">{p.reason ?? "Önizleme yok."}</span></div>;

  if (p.kind === "image" && p.url) {
    return (
      <div className="card" style={{ padding: 12, textAlign: "center" }}>
        <img
          src={API_BASE_URL + p.url}
          alt={path}
          style={{ maxWidth: "100%", height: "auto", borderRadius: 10, background: "#fff" }}
          width={p.width ?? undefined}
          height={p.height ?? undefined}
        />
      </div>
    );
  }

  if (p.kind === "pdf") {
    return (
      <div className="stack" style={{ gap: 12 }}>
        <div className="faint" style={{ fontSize: 12 }}>
          {p.page_count} sayfa{p.truncated ? ` · ilk ${p.pages.length} sayfa gösteriliyor` : ""}
        </div>
        {p.pages.map((pg, i) => (
          <div key={i} style={{ position: "relative" }}>
            <img
              src={API_BASE_URL + pg.url}
              alt={`${path} sayfa ${i + 1}`}
              loading="lazy"
              width={pg.width}
              height={pg.height}
              style={{ width: "100%", height: "auto", display: "block", borderRadius: 8, background: "#fff",
                       boxShadow: "0 10px 30px rgba(0,0,0,0.35)" }}
            />
            <span className="faint" style={{ position: "absolute", right: 10, bottom: 8, fontSize: 11,
                  background: "rgba(0,0,0,0.55)", color: "#fff", padding: "2px 8px", borderRadius: 99 }}>
              {i + 1}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return <DocxView blocks={p.blocks} />;
}

function Runs({ runs }: { runs: DocRun[] }) {
  return (
    <>
      {runs.map((r, i) => (
        <span key={i} style={{ fontWeight: r.b ? 700 : undefined, fontStyle: r.i ? "italic" : undefined, whiteSpace: "pre-wrap" }}>
          {r.s}
        </span>
      ))}
    </>
  );
}

/** DOCX blokları: kâğıt görünümlü, okunaklı sayfa. */
function DocxView({ blocks }: { blocks: DocBlock[] }) {
  if (!blocks.length) return <div className="card"><span className="muted">Belge boş görünüyor.</span></div>;
  return (
    <div
      style={{ background: "#fbfaf7", color: "#1b1913", borderRadius: 12, padding: "28px 26px", lineHeight: 1.6,
               fontSize: 15, boxShadow: "0 10px 30px rgba(0,0,0,0.3)", overflowX: "auto" }}
    >
      {blocks.map((b, i) => {
        if (b.t === "h") {
          const size = b.level === 1 ? 22 : b.level === 2 ? 19 : 17;
          return <div key={i} style={{ fontSize: size, fontWeight: 700, margin: "16px 0 6px" }}><Runs runs={b.runs} /></div>;
        }
        if (b.t === "li") {
          return (
            <div key={i} style={{ display: "flex", gap: 8, marginLeft: 18 + b.depth * 18, marginBottom: 2 }}>
              <span>{b.ordered ? "–" : "•"}</span>
              <span style={{ minWidth: 0 }}><Runs runs={b.runs} /></span>
            </div>
          );
        }
        if (b.t === "img") {
          return <img key={i} src={b.src} alt="" style={{ maxWidth: "100%", height: "auto", margin: "10px 0", borderRadius: 6 }} />;
        }
        if (b.t === "table") {
          return (
            <table key={i} style={{ borderCollapse: "collapse", margin: "10px 0", fontSize: 14, width: "100%" }}>
              <tbody>
                {b.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => (
                      <td key={c} style={{ border: "1px solid #d8d2c4", padding: "6px 8px", fontWeight: r === 0 ? 600 : undefined }}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          );
        }
        return <p key={i} style={{ margin: "0 0 8px" }}><Runs runs={b.runs} /></p>;
      })}
    </div>
  );
}
