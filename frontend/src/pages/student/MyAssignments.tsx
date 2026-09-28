import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, apiUpload, ApiError } from "../../api/client";
import type { Assignment, ClassOut, SubmissionListItem } from "../../api/types";
import { dueLabel, dueOf, formatDate, isPast } from "../../lib/format";
import { PrecheckPanel } from "../../components/student/PrecheckPanel";

export function MyAssignments() {
  const [items, setItems] = useState<{ cls: ClassOut; assignments: Assignment[] }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const classes = await api<ClassOut[]>("/classes");
        const withA = await Promise.all(
          classes.map(async (cls) => ({
            cls,
            assignments: await api<Assignment[]>(`/assignments?class_id=${cls.id}`),
          }))
        );
        setItems(withA);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <span className="muted">Yükleniyor…</span>;

  return (
    <div>
      <h1 className="h-page" style={{ marginBottom: 18 }}>Ödevlerim</h1>
      {items.length === 0 && (
        <div className="card"><p className="muted">Kayıtlı olduğun sınıf yok.</p></div>
      )}
      {items.map(({ cls, assignments }) => (
        <div key={cls.id} style={{ marginBottom: 26 }}>
          <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>{cls.name}</div>
          {assignments.length === 0 ? (
            <div className="card"><p className="muted">Bu sınıfta ödev yok.</p></div>
          ) : (
            <div className="stack">
              {assignments.map((a) => <UploadCard key={a.id} a={a} />)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function UploadCard({ a }: { a: Assignment }) {
  const past = isPast(dueOf(a)); // hoca uzattıysa yükleme yeniden açılır
  const [subs, setSubs] = useState<SubmissionListItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function refresh() {
    api<SubmissionListItem[]>(`/assignments/${a.id}/submissions`).then(setSubs).catch(() => {});
  }
  useEffect(refresh, [a.id]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setErr(null);
    setMsg(null);
    if (!f.name.toLowerCase().endsWith(".zip")) {
      setErr("Yalnızca .zip dosyası yükleyebilirsin.");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", f);
      const created = await apiUpload<SubmissionListItem>(`/assignments/${a.id}/submissions`, form);
      setMsg(`v${created.version_number} yüklendi.`);
      refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Yükleme başarısız.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const latest = subs[0];

  // Panodan "#odev-<id>" ile gelindiyse bu karta kaydır
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (window.location.hash === `#odev-${a.id}`)
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [a.id]);

  return (
    <div className="card" id={`odev-${a.id}`} ref={cardRef} style={{ scrollMarginTop: 80 }}>
      <div className="row between" style={{ flexWrap: "wrap", gap: 6 }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 18 }}>{a.title}</div>
        <span className={past ? "tag" : "tag tag-gold"}>{past ? "Süre doldu" : "Açık"}</span>
      </div>
      {a.description && <p className="muted" style={{ marginTop: 4 }}>{a.description}</p>}
      <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>Teslim: {dueLabel(a)}</div>
      {a.requirements_json && a.requirements_json.length > 0 && (
        <ul style={{ margin: "10px 0 0", paddingLeft: 18 }}>
          {a.requirements_json.map((r, i) => (
            <li key={i} className="muted" style={{ fontSize: 13 }}>{r}</li>
          ))}
        </ul>
      )}
      <hr />
      <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}>
        <label className="btn btn-gold" style={{ cursor: past || busy ? "default" : "pointer", opacity: past ? 0.6 : 1 }}>
          {busy ? "Yükleniyor…" : latest ? "Yeni sürüm yükle (.zip)" : "ZIP yükle"}
          <input
            ref={fileRef}
            type="file"
            accept=".zip"
            onChange={onFile}
            disabled={busy || past}
            style={{ display: "none" }}
          />
        </label>
        {latest && (
          <Link className="btn btn-ghost" to={`/gonderim/${latest.id}`}>
            Son sürümü görüntüle (v{latest.version_number})
          </Link>
        )}
      </div>
      {msg && <p className="ok">{msg}</p>}
      {err && <p className="error">{err}</p>}
      {subs.length > 0 && (
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          {subs.length} sürüm · en son: v{latest.version_number} ({formatDate(latest.submitted_at)})
        </div>
      )}
      {a.precheck_enabled && !past && <PrecheckPanel assignmentId={a.id} />}
    </div>
  );
}
