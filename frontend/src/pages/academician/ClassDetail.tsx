import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../../api/client";
import { API_BASE_URL } from "../../config";
import type {
  Assignment,
  ClassGrades,
  ClassOut,
  OverviewAssignment,
  Reopen,
  Roster,
  RosterRow,
  TeachingOverview,
  User,
} from "../../api/types";
import { dueLabel, dueOf, formatDate, isPast, isoToLocalInput, localInputToISO, timeLeft } from "../../lib/format";
import { ClassAiModal } from "../../components/review/ClassAiModal";
import { IconDownload, IconMore, IconPlus, IconSparkle } from "../../components/icons";

type Tab = "odevler" | "ogrenciler" | "notlar";

export function ClassDetail() {
  const { classId = "" } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [cls, setCls] = useState<ClassOut | null>(null);
  const [students, setStudents] = useState<User[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [stats, setStats] = useState<Record<string, OverviewAssignment>>({});
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [ai, setAi] = useState<{ open: boolean; studentId?: string }>({ open: false });
  const [menu, setMenu] = useState(false);
  const [creating, setCreating] = useState(false);

  const tab = (params.get("sekme") as Tab) || "odevler";
  const selectedId = params.get("odev");
  const setTab = (t: Tab) => {
    const p = new URLSearchParams(params);
    p.set("sekme", t);
    setParams(p, { replace: true });
  };
  const select = (id: string) => {
    setCreating(false);
    const p = new URLSearchParams(params);
    p.set("odev", id);
    p.delete("sekme");
    setParams(p, { replace: true });
  };

  async function refresh() {
    setErr(null);
    try {
      const [clsList, studs, asgs, ov] = await Promise.all([
        api<ClassOut[]>("/classes"),
        api<User[]>(`/classes/${classId}/students`),
        api<Assignment[]>(`/assignments?class_id=${classId}`),
        api<TeachingOverview>("/me/teaching-overview"),
      ]);
      setCls(clsList.find((c) => c.id === classId) ?? null);
      setStudents(studs);
      setAssignments(asgs);
      const mine = ov.classes.find((c) => c.id === classId);
      setStats(Object.fromEntries((mine?.assignments ?? []).map((a) => [a.id, a])));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);

  // Varsayılan seçim: açık olanların en yakını, yoksa en yenisi
  const selected = useMemo(() => {
    if (!assignments.length) return null;
    const byId = assignments.find((a) => a.id === selectedId);
    if (byId) return byId;
    const open = assignments.filter((a) => !isPast(dueOf(a))).sort((a, b) => dueOf(a).localeCompare(dueOf(b)));
    return open[0] ?? assignments[0];
  }, [assignments, selectedId]);

  // Not dosyasi: kisa omurlu imzali link alinir, tarayici indirir.
  const [exporting, setExporting] = useState(false);
  async function exportGrades() {
    setExporting(true);
    setErr(null);
    try {
      const { url } = await api<{ url: string }>(`/classes/${classId}/gradebook-link`, { method: "POST" });
      window.location.assign(`${API_BASE_URL}${url}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Not dosyası hazırlanamadı.");
    } finally {
      setExporting(false);
    }
  }

  async function deleteClass() {
    setMenu(false);
    if (!window.confirm(`"${cls?.name ?? "Sınıf"}" silinecek. Emin misin?`)) return;
    try {
      await api(`/classes/${classId}`, { method: "DELETE" });
      navigate("/panel");
    } catch (e) {
      alert(e instanceof ApiError ? e.message : "Sınıf silinemedi.");
    }
  }

  if (loading) return <span className="muted">Yükleniyor…</span>;

  return (
    <div style={{ paddingBottom: 24 }}>
      <div className="muted" style={{ fontSize: 13 }}>
        <Link to="/panel" className="muted">
          Panom
        </Link>{" "}
        / {cls?.name ?? "Sınıf"}
      </div>
      <div className="row between" style={{ marginTop: 8, flexWrap: "wrap", gap: 12 }}>
        <div className="row" style={{ gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
          <h1 className="h-page" style={{ margin: 0 }}>{cls?.name ?? "Sınıf"}</h1>
          {cls?.term && <span className="tag">{cls.term}</span>}
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-gold" onClick={() => setAi({ open: true })}>
            <IconSparkle />
            AI özeti
          </button>
          <button
            className="btn"
            onClick={exportGrades}
            disabled={exporting}
            title="Notları ve ayrıntıları Excel dosyası olarak indir (OBS'ye aktarmak için)"
          >
            <IconDownload />
            {exporting ? "Hazırlanıyor…" : "Notları Excel'e aktar"}
          </button>
          <div style={{ position: "relative" }}>
            <button className="btn icon-btn btn-icon-only" aria-label="Diğer işlemler" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
              <IconMore size={18} />
            </button>
            {menu && (
              <div className="menu" role="menu">
                <button role="menuitem" style={{ color: "var(--danger)" }} onClick={deleteClass}>
                  Sınıfı sil
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      {ai.open && (
        <ClassAiModal
          classId={classId}
          className={cls?.name ?? "Sınıf"}
          initialStudentId={ai.studentId}
          onClose={() => setAi({ open: false })}
        />
      )}
      {err && <p className="error">{err}</p>}

      <div className="tabs" role="tablist" style={{ margin: "18px 0 18px" }}>
        <button role="tab" aria-selected={tab === "odevler"} className={"tab" + (tab === "odevler" ? " on" : "")} onClick={() => setTab("odevler")}>
          Ödevler<span className="n">{assignments.length}</span>
        </button>
        <button role="tab" aria-selected={tab === "ogrenciler"} className={"tab" + (tab === "ogrenciler" ? " on" : "")} onClick={() => setTab("ogrenciler")}>
          Öğrenciler<span className="n">{students.length}</span>
        </button>
        <button role="tab" aria-selected={tab === "notlar"} className={"tab" + (tab === "notlar" ? " on" : "")} onClick={() => setTab("notlar")}>
          Not çizelgesi
        </button>
      </div>

      {tab === "odevler" && (
        <div className="split">
          <div className="stack" style={{ gap: 10 }}>
            <button
              className="btn"
              style={{ borderStyle: "dashed", width: "100%" }}
              onClick={() => setCreating(true)}
            >
              <IconPlus />
              Yeni ödev
            </button>
            {assignments.length === 0 && <p className="muted" style={{ fontSize: 13.5 }}>Henüz ödev yok.</p>}
            {assignments.map((a) => {
              const st = stats[a.id];
              const past = isPast(dueOf(a));
              const pct = st && st.enrolled ? Math.round((st.submitted / st.enrolled) * 100) : 0;
              return (
                <button
                  key={a.id}
                  className={"asg-item" + (!creating && selected?.id === a.id ? " on" : "")}
                  onClick={() => select(a.id)}
                >
                  <div style={{ fontWeight: 600, fontSize: 14.5 }}>{a.title}</div>
                  <div className="row" style={{ gap: 6, marginTop: 7, flexWrap: "wrap" }}>
                    <span className={past ? "chip" : "chip chip-gold"}>{past ? "Süre doldu" : `Açık · ${timeLeft(dueOf(a))}`}</span>
                    {st && (
                      <span className="muted" style={{ fontSize: 12 }}>
                        {st.submitted}/{st.enrolled} teslim
                      </span>
                    )}
                  </div>
                  {st && (
                    <div className={"progress" + (pct >= 100 ? " done" : "")} style={{ marginTop: 9, height: 5 }}>
                      <span style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <div>
            {creating ? (
              <CreateAssignment
                classId={classId}
                onCancel={() => setCreating(false)}
                onDone={(id) => {
                  setCreating(false);
                  refresh().then(() => select(id));
                }}
              />
            ) : selected ? (
              <AssignmentPanel key={selected.id} a={selected} onChanged={refresh} />
            ) : (
              <div className="card">
                <p className="muted" style={{ margin: 0 }}>Sol taraftaki "Yeni ödev" ile ilk ödevi oluştur.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "ogrenciler" && (
        <StudentsTab
          classId={classId}
          students={students}
          onDone={refresh}
          onAi={(studentId) => setAi({ open: true, studentId })}
        />
      )}

      {tab === "notlar" && <GradesTab classId={classId} onExport={exportGrades} exporting={exporting} />}
    </div>
  );
}

/* ---------------- Seçili ödev ---------------- */
function AssignmentPanel({ a, onChanged }: { a: Assignment; onChanged: () => void }) {
  const [panel, setPanel] = useState<"none" | "reopen" | "edit">("none");
  const [deleting, setDeleting] = useState(false);
  const [tick, setTick] = useState(0); // uzatma degisince teslim tablosu tazelenir
  const changed = () => {
    onChanged();
    setTick((t) => t + 1);
  };
  const toggle = (p: typeof panel) => setPanel((cur) => (cur === p ? "none" : p));
  const reqs = a.requirements_json ?? [];

  async function remove() {
    if (!window.confirm(`"${a.title}" ödevi ve tüm gönderimleri kalıcı olarak silinecek. Emin misin?`)) return;
    setDeleting(true);
    try {
      await api(`/assignments/${a.id}`, { method: "DELETE" });
      onChanged();
    } catch (e) {
      alert(e instanceof ApiError ? e.message : "Silinemedi.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="card" style={{ padding: "20px 22px" }}>
      <div className="row between" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 22 }}>{a.title}</h2>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            Son teslim {dueLabel(a)} · {reqs.length} kural
            {a.precheck_enabled ? ` · Ön kontrol açık (${a.precheck_limit}/gün)` : ""}
          </div>
          <div className="faint" style={{ fontSize: 12, marginTop: 2 }}>
            Öğrenci AI sonuçlarını görüyor: gereksinim {a.show_requirement_to_student === false ? "✗" : "✓"} · Clean Code{" "}
            {a.show_clean_code_to_student === false ? "✗" : "✓"}
          </div>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <button className={"btn btn-sm" + (panel === "reopen" ? " btn-gold" : "")} onClick={() => toggle("reopen")}>
            Teslim süresi
          </button>
          <button className={"btn btn-sm" + (panel === "edit" ? " btn-gold" : "")} onClick={() => toggle("edit")}>
            Düzenle
          </button>
          <button className="btn btn-sm btn-danger-ghost" onClick={remove} disabled={deleting}>
            {deleting ? "…" : "Sil"}
          </button>
        </div>
      </div>
      {a.description && <p className="muted" style={{ margin: "10px 0 0", fontSize: 14 }}>{a.description}</p>}
      {reqs.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>
            Kurallar ({reqs.length})
          </summary>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            {reqs.map((r, i) => (
              <li key={i} className="muted" style={{ fontSize: 13 }}>
                {r}
              </li>
            ))}
          </ul>
        </details>
      )}

      {panel === "edit" && (
        <EditAssignment
          a={a}
          onDone={() => {
            setPanel("none");
            onChanged();
          }}
        />
      )}
      {panel === "reopen" && <ExtensionsPanel a={a} onChanged={changed} />}

      <RosterTable assignmentId={a.id} refreshKey={tick} onChanged={changed} />
    </section>
  );
}

function statusChip(r: RosterRow, warn: number) {
  if (r.similarity != null && r.similarity >= warn)
    return <span className="chip chip-danger">Benzerlik %{r.similarity}</span>;
  switch (r.status) {
    case "none":
      return <span className="chip">Teslim yok</span>;
    case "ungraded":
      return <span className="chip chip-blue">Notlanmadı</span>;
    case "new_version":
      return <span className="chip chip-gold">Yeni sürüm (not v{r.graded_version})</span>;
    default:
      return <span className="chip chip-ok">Notlandı</span>;
  }
}

function RosterTable({
  assignmentId,
  refreshKey,
  onChanged,
}: {
  assignmentId: string;
  refreshKey: number;
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const [roster, setRoster] = useState<Roster | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [extFor, setExtFor] = useState<string | null>(null); // "Süre ver" açık öğrenci

  useEffect(() => {
    api<Roster>(`/assignments/${assignmentId}/roster`)
      .then(setRoster)
      .catch((e) => setErr(e instanceof ApiError ? e.message : "Teslimler yüklenemedi."));
  }, [assignmentId, refreshKey]);

  if (err) return <p className="error">{err}</p>;
  if (!roster) return <p className="muted" style={{ marginTop: 16 }}>Teslimler yükleniyor…</p>;
  if (roster.rows.length === 0)
    return <p className="muted" style={{ marginTop: 16 }}>Bu sınıfta kayıtlı öğrenci yok. "Öğrenciler" sekmesinden ekleyebilirsin.</p>;

  return (
    <div style={{ marginTop: 18 }}>
      <div className="row between" style={{ marginBottom: 8, flexWrap: "wrap", gap: 6 }}>
        <span className="eyebrow">Teslimler</span>
        <span className="muted" style={{ fontSize: 12.5 }}>
          {roster.submitted}/{roster.enrolled} teslim · {roster.graded} notlandı
          {roster.needs_review ? ` · ${roster.needs_review} bekliyor` : ""}
        </span>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Öğrenci</th>
              <th>No</th>
              <th>Sürüm</th>
              <th>Durum</th>
              <th className="num">Not</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {roster.rows.map((r) => (
              <Fragment key={r.student.id}>
              <tr
                className={r.latest ? "clickable" : undefined}
                onClick={() => r.latest && navigate(`/gonderim/${r.latest.id}`)}
              >
                <td style={{ fontWeight: 500, color: r.latest ? undefined : "var(--muted)" }}>{r.student.full_name}</td>
                <td className="muted">{r.student.school_no ?? "—"}</td>
                <td>
                  {r.latest ? (
                    <span title={formatDate(r.latest.submitted_at)}>
                      v{r.latest.version_number}
                      {r.versions > 1 && <span className="muted" style={{ fontSize: 12 }}> ({r.versions})</span>}
                    </span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  <span className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                    {statusChip(r, roster.similarity_warn)}
                    {r.extended_until && (
                      <span className="chip chip-gold" title="Bu öğrenciye özel süre">
                        Süre: {formatDate(r.extended_until)}
                      </span>
                    )}
                  </span>
                </td>
                <td className="num">{r.score ?? <span className="muted">—</span>}</td>
                <td className="num" style={{ whiteSpace: "nowrap" }}>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ padding: "3px 8px", fontSize: 12, marginRight: 6 }}
                    title="Bu öğrenciye özel teslim süresi ver"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExtFor((cur) => (cur === r.student.id ? null : r.student.id));
                    }}
                  >
                    Süre ver
                  </button>
                  {r.latest && (
                    <Link to={`/gonderim/${r.latest.id}`} onClick={(e) => e.stopPropagation()} style={{ fontWeight: 600 }}>
                      İncele
                    </Link>
                  )}
                </td>
              </tr>
              {extFor === r.student.id && (
                <tr>
                  <td colSpan={6} style={{ background: "var(--bg-3)" }}>
                    <PersonalExtension
                      assignmentId={assignmentId}
                      studentId={r.student.id}
                      studentName={r.student.full_name}
                      onDone={() => {
                        setExtFor(null);
                        onChanged();
                      }}
                    />
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>
        Satıra tıklayınca gönderim açılır. Kırmızı ve sarı durumlar notlamadan önce bakılması gerekenleri gösterir.
      </p>
    </div>
  );
}

/* ---------------- Öğrenciler ---------------- */
function StudentsTab({
  classId,
  students,
  onDone,
  onAi,
}: {
  classId: string;
  students: User[];
  onDone: () => void;
  onAi: (studentId: string) => void;
}) {
  const [studentNo, setStudentNo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setOk(null);
    setBusy(true);
    try {
      await api(`/classes/${classId}/enroll`, { method: "POST", body: { student_no: studentNo.trim() } });
      setOk(`${studentNo.trim()} numaralı öğrenci eklendi.`);
      setStudentNo("");
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Eklenemedi.");
    } finally {
      setBusy(false);
    }
  }

  // Hocanın kendi öğrencisinin şifresini sıfırlaması: geçici şifre yalnızca bir kez gösterilir
  const [temp, setTemp] = useState<{ name: string; no: string | null; password: string } | null>(null);

  async function resetPassword(s: User) {
    if (
      !window.confirm(
        `${s.full_name} için geçici şifre oluşturulsun mu? Açık oturumları kapanır; ilk girişte kendi şifresini belirler.`
      )
    )
      return;
    try {
      const r = await api<{ student_name: string; school_no: string | null; temp_password: string }>(
        `/classes/${classId}/students/${s.id}/reset-password`,
        { method: "POST" }
      );
      setTemp({ name: r.student_name, no: r.school_no, password: r.temp_password });
    } catch (e) {
      alert(e instanceof ApiError ? e.message : "Şifre sıfırlanamadı.");
    }
  }

  async function remove(s: User) {
    if (!window.confirm(`${s.full_name} sınıftan çıkarılsın mı?`)) return;
    try {
      await api(`/classes/${classId}/students/${s.id}`, { method: "DELETE" });
      onDone();
    } catch (e) {
      alert(e instanceof ApiError ? e.message : "Çıkarılamadı.");
    }
  }

  return (
    <div className="cols-main">
      <div>
      {temp && (
        <div className="panel" style={{ padding: 14, marginBottom: 12, borderLeft: "3px solid var(--gold)" }}>
          <div style={{ fontWeight: 600 }}>Şifre sıfırlandı: {temp.name}{temp.no ? ` (${temp.no})` : ""}</div>
          <div className="muted" style={{ fontSize: 13, margin: "4px 0 8px" }}>
            Geçici şifre <b>yalnızca şimdi</b> gösteriliyor; öğrenciye yüz yüze ya da güvenli bir kanaldan ilet. İlk
            girişte kendi şifresini belirleyecek.
          </div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <code style={{ fontSize: 18, letterSpacing: 1 }}>{temp.password}</code>
            <button className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(temp.password).catch(() => {})}>
              Kopyala
            </button>
            <button className="btn btn-sm btn-primary" onClick={() => setTemp(null)}>Tamam</button>
          </div>
        </div>
      )}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {students.length === 0 ? (
          <p className="muted" style={{ padding: 20, margin: 0 }}>Henüz öğrenci yok. Sağdaki formla okul numarasıyla ekle.</p>
        ) : (
          <div className="table-wrap">
            <table className="table" style={{ border: 0, borderRadius: 0 }}>
              <thead>
                <tr>
                  <th>Ad Soyad</th>
                  <th>Okul No</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 500 }}>{s.full_name}</td>
                    <td className="muted">{s.school_no ?? "—"}</td>
                    <td className="num">
                      <span className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                        <button className="ai-btn" title="Öğrencinin AI özeti" onClick={() => onAi(s.id)}>
                          <IconSparkle size={13} />
                          AI
                        </button>
                        {!s.is_demo && (
                          <button className="btn btn-ghost btn-sm" title="Şifresini unutan öğrenciye geçici şifre ver"
                            onClick={() => resetPassword(s)}>
                            Şifre sıfırla
                          </button>
                        )}
                        <button className="btn btn-ghost btn-sm btn-danger-ghost" onClick={() => remove(s)}>
                          Çıkar
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </div>
      <form className="card" onSubmit={submit}>
        <h3 style={{ fontSize: 15 }}>Öğrenci ekle</h3>
        <div className="field">
          <label>Okul numarası</label>
          <input value={studentNo} onChange={(e) => setStudentNo(e.target.value)} inputMode="numeric" placeholder="Örn: 2025001" required />
        </div>
        {err && <p className="error">{err}</p>}
        {ok && <p className="ok">{ok}</p>}
        <button className="btn btn-primary" disabled={busy || !studentNo.trim()} style={{ width: "100%" }}>
          {busy ? "…" : "Sınıfa ekle"}
        </button>
      </form>
    </div>
  );
}

/* ---------------- Not çizelgesi ---------------- */
function GradesTab({ classId, onExport, exporting }: { classId: string; onExport: () => void; exporting: boolean }) {
  const [g, setG] = useState<ClassGrades | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<ClassGrades>(`/classes/${classId}/grades`)
      .then(setG)
      .catch((e) => setErr(e instanceof ApiError ? e.message : "Notlar yüklenemedi."));
  }, [classId]);

  if (err) return <p className="error">{err}</p>;
  if (!g) return <span className="muted">Yükleniyor…</span>;

  return (
    <div className="stack">
      <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Her ödev için verdiğin en son not. Boş hücre: not verilmemiş (0 sayılmaz).
        </p>
        <button className="btn btn-sm" onClick={onExport} disabled={exporting}>
          <IconDownload size={14} />
          {exporting ? "Hazırlanıyor…" : "Excel'e aktar"}
        </button>
      </div>
      {g.rows.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>Sınıfta öğrenci yok.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>No</th>
                <th>Ad Soyad</th>
                {g.assignments.map((a) => (
                  <th key={a.id} className="num" title={a.title} style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {a.title.split(":")[0]}
                  </th>
                ))}
                <th className="num">Ortalama</th>
              </tr>
            </thead>
            <tbody>
              {g.rows.map((r) => (
                <tr key={r.student.id}>
                  <td className="muted">{r.student.school_no ?? "—"}</td>
                  <td style={{ fontWeight: 500, whiteSpace: "nowrap" }}>{r.student.full_name}</td>
                  {r.scores.map((s, i) => (
                    <td key={i} className="num" title={r.statuses[i] === "none" ? "Teslim yok" : r.statuses[i] === "graded" ? undefined : "Notlanmayı bekliyor"}>
                      {s ?? (
                        <span style={{ color: r.statuses[i] === "none" ? "var(--faint)" : "var(--blue-soft)" }}>
                          {r.statuses[i] === "none" ? "—" : "•"}
                        </span>
                      )}
                    </td>
                  ))}
                  <td className="num" style={{ fontWeight: 700 }}>{r.average ?? <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="faint" style={{ fontSize: 12, margin: 0 }}>— teslim yok · <span style={{ color: "var(--blue-soft)" }}>•</span> teslim var, notlanmadı</p>
    </div>
  );
}

/* ---------------- Formlar ---------------- */

/** Öğrencinin teslim öncesi ön kontrol izni + 24 saatlik hak sayısı. */
function PrecheckSettings({
  enabled,
  limit,
  onChange,
}: {
  enabled: boolean;
  limit: number;
  onChange: (enabled: boolean, limit: number) => void;
}) {
  return (
    <div className="panel" style={{ padding: 12, marginBottom: 16 }}>
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", margin: 0, color: "var(--ink)" }}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange(e.target.checked, limit)}
          style={{ width: "auto", marginTop: 3 }}
        />
        <span>
          Öğrenciler teslim etmeden önce AI ön kontrolü yapabilsin
          <span className="muted" style={{ display: "block", fontSize: 12, fontWeight: 400 }}>
            Kodlarını kurallara göre kontrol edip eksiklerini teslimden önce görürler. Teslim sayılmaz.
          </span>
        </span>
      </label>
      {enabled && (
        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          <span className="muted" style={{ fontSize: 13 }}>Öğrenci başına 24 saatte</span>
          <input
            type="number"
            min={1}
            max={20}
            value={limit}
            onChange={(e) => onChange(enabled, Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
            style={{ width: 70 }}
          />
          <span className="muted" style={{ fontSize: 13 }}>hak</span>
        </div>
      )}
    </div>
  );
}

function EditAssignment({ a, onDone }: { a: Assignment; onDone: () => void }) {
  const [title, setTitle] = useState(a.title);
  const [description, setDescription] = useState(a.description ?? "");
  const [deadline, setDeadline] = useState(isoToLocalInput(a.deadline_at));
  const [reqText, setReqText] = useState((a.requirements_json ?? []).join("\n"));
  const [pre, setPre] = useState({ enabled: !!a.precheck_enabled, limit: a.precheck_limit ?? 3 });
  const [vis, setVis] = useState({
    requirement: a.show_requirement_to_student !== false,
    cleanCode: a.show_clean_code_to_student !== false,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const deadlineChanged = deadline !== isoToLocalInput(a.deadline_at);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (deadlineChanged && !confirmPastDeadline(deadline)) return;
    setBusy(true);
    try {
      await api(`/assignments/${a.id}`, {
        method: "PATCH",
        body: {
          title,
          description: description || null,
          requirements: reqText.split("\n").map((s) => s.trim()).filter(Boolean),
          deadline_at: localInputToISO(deadline),
          precheck_enabled: pre.enabled,
          precheck_limit: pre.limit,
          show_requirement_to_student: vis.requirement,
          show_clean_code_to_student: vis.cleanCode,
        },
      });
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Güncellenemedi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="panel" style={{ padding: 14, marginTop: 14 }}>
      <div className="field">
        <label>Başlık</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} required />
      </div>
      <div className="field">
        <label>Açıklama</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
      </div>
      <div className="field">
        <label>Teslim tarihi</label>
        <input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} required />
        {deadlineChanged && (
          <p className="faint" style={{ fontSize: 12, margin: "6px 0 0" }}>
            Yeni tarih, tüm sınıfa verilmiş uzatmanın yerine geçer. Öğrenciye özel uzatmalar kalır
            ("Teslim süresi"nden iptal edebilirsin).
          </p>
        )}
      </div>
      <div className="field">
        <label>Gereksinimler (her satır bir madde)</label>
        <textarea value={reqText} onChange={(e) => setReqText(e.target.value)} rows={4} />
      </div>
      <PrecheckSettings enabled={pre.enabled} limit={pre.limit} onChange={(enabled, limit) => setPre({ enabled, limit })} />
      <StudentVisibility value={vis} onChange={setVis} />
      {err && <p className="error">{err}</p>}
      <button className="btn btn-primary" disabled={busy || !title}>
        {busy ? "…" : "Kaydet"}
      </button>
    </form>
  );
}

/** Geçmiş bir tarih seçildiyse onay ister (teslimler hemen kapanır). */
function confirmPastDeadline(local: string): boolean {
  if (!local || new Date(local).getTime() > Date.now()) return true;
  return window.confirm("Seçtiğin tarih geçmişte. Kaydedersen teslimler hemen kapanır. Emin misin?");
}

/** Hocanın başlattığı AI sonuçlarını öğrenci görsün mü (ödev bazında, hocanın kararı). */
function StudentVisibility({
  value,
  onChange,
}: {
  value: { requirement: boolean; cleanCode: boolean };
  onChange: (v: { requirement: boolean; cleanCode: boolean }) => void;
}) {
  const box = (checked: boolean, set: (v: boolean) => void, label: string) => (
    <label style={{ display: "flex", gap: 8, alignItems: "center", margin: 0, color: "var(--ink)", fontWeight: 500 }}>
      <input type="checkbox" checked={checked} onChange={(e) => set(e.target.checked)} style={{ width: "auto" }} />
      {label}
    </label>
  );
  return (
    <div className="panel" style={{ padding: 12, marginBottom: 16 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>Öğrenci, başlattığın AI analizlerinin sonucunu görsün</div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
        Kapalıysa sonucu yalnızca sen görürsün; öğrencinin gelişim grafiği ve rozetleri de bu sonuçtan etkilenmez.
        "Eksikleri gönder" ile ilettiklerin her durumda öğrenciye ulaşır.
      </div>
      <div className="stack" style={{ gap: 6 }}>
        {box(value.requirement, (v) => onChange({ ...value, requirement: v }), "Gereksinim kontrolü sonucu")}
        {box(value.cleanCode, (v) => onChange({ ...value, cleanCode: v }), "Clean Code sonucu")}
      </div>
    </div>
  );
}

/** Teslim süresi: durum, "şimdi bitir", tüm sınıfa uzat, verilmiş uzatmalar (iptal edilebilir).
 *  Süreyle ilgili her işlem tek yerde. */
function ExtensionsPanel({ a, onChanged }: { a: Assignment; onChanged: () => void }) {
  const assignmentId = a.id;
  const [until, setUntil] = useState("");
  const [closing, setClosing] = useState(false);
  const [list, setList] = useState<Reopen[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  function load() {
    api<Reopen[]>(`/assignments/${assignmentId}/reopens`).then(setList).catch(() => {});
  }
  useEffect(load, [assignmentId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setOk(null);
    setBusy(true);
    try {
      await api(`/assignments/${assignmentId}/reopen`, {
        method: "POST",
        body: { student_id: null, reopened_until: localInputToISO(until) },
      });
      setOk("Tüm sınıf için süre uzatıldı; öğrencilere bildirim gitti.");
      setUntil("");
      load();
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Başarısız.");
    } finally {
      setBusy(false);
    }
  }

  const activePersonal = list.filter((r) => r.active && r.student_id);
  const openForSomeone = !isPast(dueOf(a)) || list.some((r) => r.active);

  async function closeNow() {
    const extra = activePersonal.length
      ? ` ${activePersonal.length} öğrenciye verilen özel süre de sona erecek.`
      : "";
    if (!window.confirm(`Teslim herkes için şimdi kapansın mı?${extra} Öğrencilere bildirim gider; istersen sonra yeniden süre verebilirsin.`))
      return;
    setErr(null);
    setOk(null);
    setClosing(true);
    try {
      await api(`/assignments/${assignmentId}/close`, { method: "POST" });
      setOk("Teslim kapatıldı.");
      load();
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Kapatılamadı.");
    } finally {
      setClosing(false);
    }
  }

  async function cancel(r: Reopen) {
    const who = r.student_name ? `${r.student_name} için` : "Tüm sınıf için";
    if (!window.confirm(`${who} verilen uzatma iptal edilsin mi? Öğrenci(ler)e bildirim gider.`)) return;
    try {
      await api(`/assignments/${assignmentId}/reopens/${r.id}`, { method: "DELETE" });
      load();
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "İptal edilemedi.");
    }
  }

  return (
    <div className="panel" style={{ padding: 14, marginTop: 14 }}>
      <div className="row between" style={{ flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        <div>
          <div className="eyebrow">Durum</div>
          <div style={{ fontWeight: 600, marginTop: 2 }}>
            {openForSomeone ? (
              isPast(dueOf(a)) ? (
                <>Sınıfa kapalı · {activePersonal.length} öğrencinin özel süresi var</>
              ) : (
                <>Açık · {timeLeft(dueOf(a))} kaldı ({formatDate(dueOf(a))})</>
              )
            ) : (
              <>Kapalı</>
            )}
          </div>
        </div>
        {openForSomeone && (
          <button className="btn btn-sm btn-danger-ghost" onClick={closeNow} disabled={closing}>
            {closing ? "Kapatılıyor…" : "Teslimi şimdi bitir"}
          </button>
        )}
      </div>
      <form onSubmit={submit}>
        <div className="field">
          <label>Tüm sınıf için yeni son tarih</label>
          <input type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} required />
        </div>
        {err && <p className="error">{err}</p>}
        {ok && <p className="ok">{ok}</p>}
        <button className="btn" disabled={busy || !until}>
          {busy ? "…" : "Tüm sınıfa uzat"}
        </button>
        <span className="faint" style={{ fontSize: 12, marginLeft: 10 }}>
          Tek öğrenciye süre için aşağıdaki tabloda "Süre ver".
        </span>
      </form>
      <div className="eyebrow" style={{ marginTop: 16, marginBottom: 6 }}>Verilmiş uzatmalar</div>
      {list.length === 0 ? (
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>Uzatma yok.</p>
      ) : (
        <div className="stack" style={{ gap: 6 }}>
          {list.map((r) => (
            <div key={r.id} className="row between" style={{ fontSize: 13.5, gap: 8, opacity: r.active ? 1 : 0.55 }}>
              <span>
                <b>{r.student_name ?? "Tüm sınıf"}</b> · {formatDate(r.reopened_until)}
                {!r.active && <span className="faint"> (süresi geçti)</span>}
              </span>
              <button className="btn btn-ghost btn-sm btn-danger-ghost" onClick={() => cancel(r)}>
                İptal et
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Tek öğrenciye özel süre (teslim tablosundaki "Süre ver"). */
function PersonalExtension({
  assignmentId,
  studentId,
  studentName,
  onDone,
}: {
  assignmentId: string;
  studentId: string;
  studentName: string;
  onDone: () => void;
}) {
  const [until, setUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api(`/assignments/${assignmentId}/reopen`, {
        method: "POST",
        body: { student_id: studentId, reopened_until: localInputToISO(until) },
      });
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Süre verilemedi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="row" style={{ gap: 8, flexWrap: "wrap", padding: "4px 0" }}>
      <span style={{ fontSize: 13 }}>
        <b>{studentName}</b> için son tarih:
      </span>
      <input
        type="datetime-local"
        value={until}
        onChange={(e) => setUntil(e.target.value)}
        required
        style={{ width: "auto" }}
      />
      <button className="btn btn-sm btn-primary" disabled={busy || !until}>
        {busy ? "…" : "Süre ver"}
      </button>
      <span className="faint" style={{ fontSize: 12 }}>Yalnızca bu öğrenci yükleyebilir; bildirim gider.</span>
      {err && <span className="error">{err}</span>}
    </form>
  );
}

function CreateAssignment({
  classId,
  onDone,
  onCancel,
}: {
  classId: string;
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState("");
  const [reqText, setReqText] = useState("");
  const [pre, setPre] = useState({ enabled: false, limit: 3 });
  const [vis, setVis] = useState({ requirement: true, cleanCode: true });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => titleRef.current?.focus(), []);

  // Serbest metinden AI ile madde cikarma
  const [showAi, setShowAi] = useState(false);
  const [aiText, setAiText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);

  async function parseWithAi() {
    if (!aiText.trim()) return;
    setErr(null);
    setAiBusy(true);
    try {
      const res = await api<{ requirements: string[] }>("/assignments/parse-requirements", {
        method: "POST",
        body: { text: aiText },
      });
      const lines = res.requirements.join("\n");
      setReqText((prev) => (prev.trim() ? prev.trim() + "\n" + lines : lines));
      setShowAi(false);
      setAiText("");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Maddelere ayrılamadı.");
    } finally {
      setAiBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!confirmPastDeadline(deadline)) return;
    setBusy(true);
    try {
      const created = await api<Assignment>("/assignments", {
        method: "POST",
        body: {
          class_id: classId,
          title,
          description: description || null,
          requirements: reqText.split("\n").map((s) => s.trim()).filter(Boolean),
          deadline_at: localInputToISO(deadline),
          precheck_enabled: pre.enabled,
          precheck_limit: pre.limit,
          show_requirement_to_student: vis.requirement,
          show_clean_code_to_student: vis.cleanCode,
        },
      });
      onDone(created.id);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Oluşturulamadı.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="row between">
        <h3 style={{ fontSize: 18, margin: 0 }}>Yeni ödev</h3>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          Vazgeç
        </button>
      </div>
      <form onSubmit={submit} style={{ marginTop: 14 }}>
        <div className="field">
          <label>Başlık</label>
          <input ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div className="field">
          <label>Açıklama (opsiyonel)</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        </div>
        <div className="field">
          <label>Teslim tarihi</label>
          <input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} required />
        </div>
        <div className="field">
          <div className="row between" style={{ flexWrap: "wrap", gap: 6 }}>
            <label style={{ margin: 0 }}>Gereksinimler (her satır bir madde)</label>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowAi((s) => !s)}>
              {showAi ? "Kapat" : (<><IconSparkle size={14} />Serbest metinden çıkar (AI)</>)}
            </button>
          </div>

          {showAi && (
            <div className="panel" style={{ padding: 12, margin: "8px 0" }}>
              <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
                Ödev metnini olduğu gibi yapıştır; AI temiz, kontrol edilebilir maddelere ayırıp aşağıya ekler.
              </p>
              <textarea
                value={aiText}
                onChange={(e) => setAiText(e.target.value)}
                rows={5}
                placeholder={"1. Kullanıcıdan ad soyad alınmalı\n2. 3 sınav notu alınmalı\n..."}
              />
              <button type="button" className="btn btn-primary" style={{ marginTop: 8 }} onClick={parseWithAi} disabled={aiBusy || !aiText.trim()}>
                {aiBusy ? "Ayrılıyor…" : "Maddelere ayır"}
              </button>
            </div>
          )}

          <textarea
            value={reqText}
            onChange={(e) => setReqText(e.target.value)}
            rows={5}
            placeholder={"En az 4 endpoint olmalı\nGirdi doğrulama yapılmalı"}
            style={{ marginTop: 8 }}
          />
        </div>
        <PrecheckSettings enabled={pre.enabled} limit={pre.limit} onChange={(enabled, limit) => setPre({ enabled, limit })} />
        <StudentVisibility value={vis} onChange={setVis} />
        {err && <p className="error">{err}</p>}
        <button className="btn btn-primary" disabled={busy || !title || !deadline}>
          {busy ? "…" : "Ödev oluştur"}
        </button>
      </form>
    </div>
  );
}
