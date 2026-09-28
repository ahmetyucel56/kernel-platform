import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "../../api/client";
import type { Course, Department, OverviewClass, TeachingOverview } from "../../api/types";
import { useAuth } from "../../auth/AuthContext";
import { ClassAiModal } from "../../components/review/ClassAiModal";
import { IconAlert, IconCheck, IconPlus, IconSparkle, IconX } from "../../components/icons";
import { dayMonth, firstName, timeLeft, todayLabel } from "../../lib/format";

export function AcademicianDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [ov, setOv] = useState<TeachingOverview | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [aiClass, setAiClass] = useState<OverviewClass | null>(null);
  const [creating, setCreating] = useState(false);

  async function refresh() {
    setErr(null);
    try {
      const [o, crs, deps] = await Promise.all([
        api<TeachingOverview>("/me/teaching-overview"),
        api<Course[]>("/courses"),
        api<Department[]>("/departments"),
      ]);
      setOv(o);
      setCourses(crs);
      setDepartments(deps);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  if (loading) return <span className="muted">Yükleniyor…</span>;

  const name = firstName(user?.full_name);
  const att = ov?.attention;
  const goAssignment = (classId: string, assignmentId: string) =>
    navigate(`/sinif/${classId}?odev=${assignmentId}`);

  return (
    <div style={{ paddingBottom: 24 }}>
      <div className="row between" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 12, marginBottom: 22 }}>
        <div>
          <div className="eyebrow">{todayLabel()}</div>
          <h1 className="h-hero" style={{ margin: "6px 0 0", fontSize: "clamp(28px, 4vw, 38px)" }}>
            Hoş geldin,{" "}
            <span className="accent">{name ? `${name}${user?.role === "academician" ? " Hocam" : ""}.` : "Hocam."}</span>
          </h1>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          <IconPlus />
          Yeni sınıf
        </button>
      </div>

      {err && <p className="error">{err}</p>}

      {ov && <GettingStarted ov={ov} onCreateClass={() => setCreating(true)} />}

      {/* İlgilenmen gerekenler */}
      {att && (
        <section aria-label="İlgilenmen gerekenler" className="stat-grid" style={{ marginBottom: 26 }}>
          <StatTile
            label="Notlanmayı bekleyen"
            value={att.needs_review.count}
            unit="teslim"
            sub={att.needs_review.items[0] ? att.needs_review.items[0].title : "Hepsi notlandı"}
            onClick={att.needs_review.items[0] && (() => goAssignment(att.needs_review.items[0].class_id, att.needs_review.items[0].assignment_id))}
          />
          <StatTile
            label="Bu hafta bitiyor"
            value={att.due_soon.count}
            unit="ödev"
            sub={att.due_soon.items[0] ? `${att.due_soon.items[0].title} · ${timeLeft(att.due_soon.items[0].due)}` : "Yakın teslim yok"}
            onClick={att.due_soon.items[0] && (() => goAssignment(att.due_soon.items[0].class_id, att.due_soon.items[0].assignment_id))}
          />
          <StatTile
            warn={att.similarity.count > 0}
            icon={att.similarity.count > 0 ? <IconAlert size={14} /> : undefined}
            label="Benzerlik uyarısı"
            value={att.similarity.count}
            unit="çift"
            sub={
              att.similarity.items[0]
                ? `${att.similarity.items[0].student_name} ↔ ${att.similarity.items[0].other_name ?? "?"} · %${att.similarity.items[0].similarity}`
                : "Yüksek benzerlik yok"
            }
            onClick={att.similarity.items[0] && (() => navigate(`/gonderim/${att.similarity.items[0].submission_id}`))}
          />
          <StatTile
            label="Eksik teslim"
            value={att.missing.count}
            unit="teslim"
            sub={att.missing.items[0] ? `${att.missing.items[0].title} (açık ödev)` : "Açık ödevlerde eksik yok"}
            onClick={att.missing.items[0] && (() => goAssignment(att.missing.items[0].class_id, att.missing.items[0].assignment_id))}
          />
        </section>
      )}

      <div className="cols-main">
        <section className="stack">
          <h2 className="eyebrow" style={{ margin: 0 }}>Sınıflarım</h2>
          {ov && ov.classes.length === 0 && (
            <div className="card">
              <p className="muted" style={{ marginTop: 0 }}>Henüz sınıfın yok.</p>
              <button className="btn btn-primary" onClick={() => setCreating(true)}>
                <IconPlus />
                İlk sınıfını oluştur
              </button>
            </div>
          )}
          {ov?.classes.map((c) => <ClassCard key={c.id} c={c} onAi={() => setAiClass(c)} />)}
        </section>

        <aside className="stack">
          <h2 className="eyebrow" style={{ margin: 0 }}>Yaklaşan teslimler</h2>
          <div className="card" style={{ padding: "4px 18px" }}>
            {!ov || ov.upcoming.length === 0 ? (
              <p className="muted" style={{ fontSize: 13.5 }}>Açık ödev yok.</p>
            ) : (
              ov.upcoming.map((u, i) => {
                const dm = dayMonth(u.due);
                return (
                  <Link
                    key={u.assignment_id}
                    to={`/sinif/${u.class_id}?odev=${u.assignment_id}`}
                    className="row"
                    style={{
                      color: "inherit",
                      padding: "13px 0",
                      borderTop: i ? "1px solid var(--line)" : undefined,
                      alignItems: "center",
                    }}
                  >
                    <div className="date-badge">
                      <b>{dm.day}</b>
                      <span>{dm.mon}</span>
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{u.title}</div>
                      <div className="muted" style={{ fontSize: 12.5 }}>
                        {u.class_name} · {u.submitted}/{u.enrolled} teslim
                      </div>
                    </div>
                  </Link>
                );
              })
            )}
          </div>
          <div className="card" style={{ padding: "16px 18px" }}>
            <div style={{ fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 14 }}>Dönem sonu</div>
            <p className="muted" style={{ fontSize: 13, margin: "6px 0 0" }}>
              Notları OBS'ye aktarmak için sınıf sayfasındaki "Notları Excel'e aktar" düğmesini kullan.
            </p>
          </div>
        </aside>
      </div>

      {aiClass && <ClassAiModal classId={aiClass.id} className={aiClass.name} onClose={() => setAiClass(null)} />}

      {creating && (
        <div className="modal-backdrop" onClick={() => setCreating(false)}>
          <div className="modal" role="dialog" aria-label="Yeni sınıf" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <b style={{ fontFamily: "var(--font-display)", fontSize: 18 }}>Yeni sınıf</b>
              <button className="btn btn-ghost icon-btn btn-icon-only" aria-label="Kapat" onClick={() => setCreating(false)}>
                <IconX />
              </button>
            </div>
            <div className="modal-body">
              <CreateClassFlow
                departments={departments}
                courses={courses}
                onDone={() => {
                  setCreating(false);
                  refresh();
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Yeni hoca için "Başlarken": sınıf → öğrenci → ödev. Hepsi tamamlanınca kendiliğinden kaybolur. */
function GettingStarted({ ov, onCreateClass }: { ov: TeachingOverview; onCreateClass: () => void }) {
  const firstClass = ov.classes[0];
  const hasClass = ov.classes.length > 0;
  const hasStudents = ov.classes.some((c) => c.student_count > 0);
  const hasAssignment = ov.classes.some((c) => c.assignment_count > 0);
  if (hasClass && hasStudents && hasAssignment) return null;

  const withoutStudents = ov.classes.find((c) => c.student_count === 0) ?? firstClass;
  const steps: { done: boolean; title: string; body: string; action?: React.ReactNode }[] = [
    {
      done: hasClass,
      title: "Sınıf oluştur",
      body: "Bölüm ve dersi seç; sınıf adı kendiliğinden oluşur.",
      action: !hasClass && (
        <button className="btn btn-primary btn-sm" onClick={onCreateClass}>
          Sınıf oluştur
        </button>
      ),
    },
    {
      done: hasStudents,
      title: "Öğrencileri ekle",
      body: "Sınıf sayfasındaki Öğrenciler sekmesinden okul numarasıyla ekle.",
      action: hasClass && !hasStudents && withoutStudents && (
        <Link className="btn btn-sm" to={`/sinif/${withoutStudents.id}?sekme=ogrenciler`}>
          Öğrenci ekle
        </Link>
      ),
    },
    {
      done: hasAssignment,
      title: "İlk ödevi ver",
      body: "Ödev metnini yapıştır, AI kurallara ayırsın; teslim tarihini belirle.",
      action: hasClass && !hasAssignment && firstClass && (
        <Link className="btn btn-sm" to={`/sinif/${firstClass.id}`}>
          Ödev ver
        </Link>
      ),
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <section className="card" style={{ marginBottom: 22, borderColor: "var(--gold-dim)" }} aria-label="Başlarken">
      <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}>
        <div>
          <div className="eyebrow" style={{ color: "var(--gold)" }}>Başlarken</div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 19, marginTop: 2 }}>
            Üç adımda ilk ödevine hazırsın
          </div>
        </div>
        <span className="chip chip-gold">{doneCount}/3 tamamlandı</span>
      </div>
      <ol style={{ listStyle: "none", padding: 0, margin: "14px 0 0", display: "grid", gap: 10 }}>
        {steps.map((s, i) => (
          <li key={s.title} className="panel row between" style={{ padding: "11px 13px", gap: 12, flexWrap: "wrap" }}>
            <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
              <span
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 13,
                  flexShrink: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: `1px solid ${s.done ? "var(--ok)" : "var(--line-2)"}`,
                  color: s.done ? "var(--ok)" : "var(--muted)",
                  fontWeight: 700,
                  fontSize: 13,
                }}
              >
                {s.done ? <IconCheck size={14} /> : i + 1}
              </span>
              <div>
                <div style={{ fontWeight: 600, textDecoration: s.done ? "line-through" : undefined, color: s.done ? "var(--muted)" : undefined }}>
                  {s.title}
                </div>
                <div className="muted" style={{ fontSize: 13 }}>{s.body}</div>
              </div>
            </div>
            {s.action || null}
          </li>
        ))}
      </ol>
    </section>
  );
}

function StatTile({
  label,
  value,
  unit,
  sub,
  warn,
  icon,
  onClick,
}: {
  label: string;
  value: number;
  unit: string;
  sub: string;
  warn?: boolean;
  icon?: React.ReactNode;
  onClick?: (() => void) | false;
}) {
  const cls = "stat" + (warn ? " warn" : "") + (value === 0 ? " muted-stat" : "");
  const body = (
    <>
      <div className="k">
        {icon}
        {label}
      </div>
      <div className="v">
        {value}
        <small>{unit}</small>
      </div>
      <div className="s" title={sub}>
        {sub}
      </div>
    </>
  );
  return onClick ? (
    <button className={cls} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function ClassCard({ c, onAi }: { c: OverviewClass; onAi: () => void }) {
  const shown = c.assignments.slice(0, 3);
  return (
    <article className="card" style={{ padding: "18px 20px" }}>
      <div className="row between" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
        <Link to={`/sinif/${c.id}`} style={{ color: "inherit", minWidth: 0 }}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 20 }}>{c.name}</div>
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
            {[c.course_name, c.term, `${c.student_count} öğrenci`, `${c.assignment_count} ödev`]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </Link>
        <div className="row" style={{ gap: 8 }}>
          <button className="ai-btn" title="AI sınıf özeti" onClick={onAi}>
            <IconSparkle size={14} />
            AI özeti
          </button>
          <Link className="btn btn-sm" to={`/sinif/${c.id}`}>
            Aç
          </Link>
        </div>
      </div>
      {shown.length > 0 ? (
        <div className="mini-grid" style={{ marginTop: 14 }}>
          {shown.map((a) => {
            const pct = a.enrolled ? Math.round((a.submitted / a.enrolled) * 100) : 0;
            return (
              <Link key={a.id} to={`/sinif/${c.id}?odev=${a.id}`} className="mini" style={{ color: "inherit" }}>
                <div className="row between" style={{ fontSize: 13, gap: 6 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</span>
                  <span style={{ color: a.open ? "var(--gold)" : "var(--muted)", fontWeight: 600, whiteSpace: "nowrap" }}>
                    {a.open ? timeLeft(a.effective_deadline_at) : "Süre doldu"}
                  </span>
                </div>
                <div className={"progress" + (pct >= 100 ? " done" : "")} style={{ margin: "9px 0 6px" }}>
                  <span style={{ width: `${pct}%` }} />
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {a.submitted}/{a.enrolled} teslim
                  {a.needs_review > 0 ? ` · ${a.needs_review} notlanmadı` : a.submitted ? " · hepsi notlandı" : ""}
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <p className="muted" style={{ fontSize: 13, margin: "12px 0 0" }}>Henüz ödev yok.</p>
      )}
    </article>
  );
}

const NEW_COURSE = "__new__";

function CreateClassFlow({
  departments,
  courses,
  onDone,
}: {
  departments: Department[];
  courses: Course[];
  onDone: () => void;
}) {
  const [departmentId, setDepartmentId] = useState("");
  const [courseId, setCourseId] = useState(""); // "" | courseId | NEW_COURSE
  const [newCourseName, setNewCourseName] = useState("");
  const [newCourseCode, setNewCourseCode] = useState("");
  const [section, setSection] = useState("");
  const [term, setTerm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Secili bolumun dersleri
  const deptCourses = useMemo(
    () => courses.filter((c) => c.department_id === departmentId),
    [courses, departmentId]
  );

  const creatingNewCourse = courseId === NEW_COURSE;
  const selectedCourseName = creatingNewCourse
    ? newCourseName.trim()
    : deptCourses.find((c) => c.id === courseId)?.name ?? "";
  // Sinif adi OTOMATIK uretilir: ders adi (+ varsa sube). Ogretmen ad yazmaz.
  const generatedName = selectedCourseName
    ? section.trim()
      ? `${selectedCourseName} - ${section.trim()} Şubesi`
      : selectedCourseName
    : "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      let finalCourseId = courseId;
      if (courseId === NEW_COURSE) {
        const created = await api<Course>("/courses", {
          method: "POST",
          body: { department_id: departmentId, name: newCourseName, code: newCourseCode || null },
        });
        finalCourseId = created.id;
      }
      await api("/classes", {
        method: "POST",
        body: { course_id: finalCourseId, name: generatedName, term: term || null },
      });
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Oluşturulamadı.");
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = departmentId && (creatingNewCourse ? newCourseName.trim() : courseId);

  return (
    <form onSubmit={submit}>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Bölüm ve ders seç; sınıf adı otomatik oluşur. Tek grubun varsa şubeyi boş bırak.
      </p>
      <div className="field">
        <label>Bölüm</label>
        <select
          value={departmentId}
          onChange={(e) => {
            setDepartmentId(e.target.value);
            setCourseId("");
          }}
          required
        >
          <option value="">Seç…</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Ders</label>
        <select value={courseId} onChange={(e) => setCourseId(e.target.value)} disabled={!departmentId} required>
          <option value="">{departmentId ? "Seç…" : "Önce bölüm seç"}</option>
          {deptCourses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.code ? ` (${c.code})` : ""}
            </option>
          ))}
          {departmentId && <option value={NEW_COURSE}>+ Yeni ders oluştur…</option>}
        </select>
      </div>
      {creatingNewCourse && (
        <div className="panel" style={{ padding: 12, marginBottom: 16 }}>
          <div className="field" style={{ marginBottom: 10 }}>
            <label>Yeni ders adı</label>
            <input value={newCourseName} onChange={(e) => setNewCourseName(e.target.value)} placeholder="Web Programlama II" required />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Ders kodu (opsiyonel)</label>
            <input value={newCourseCode} onChange={(e) => setNewCourseCode(e.target.value)} placeholder="WEB202" />
          </div>
        </div>
      )}
      <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
        <div className="field" style={{ flex: 1 }}>
          <label>Şube / grup (opsiyonel)</label>
          <input value={section} onChange={(e) => setSection(e.target.value)} placeholder="ör: A" />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Dönem (opsiyonel)</label>
          <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="2025-Güz" />
        </div>
      </div>
      {generatedName && (
        <div className="panel" style={{ padding: "10px 12px", marginBottom: 16, fontSize: 13 }}>
          <span className="muted">Oluşacak sınıf: </span>
          <b>{generatedName}</b>
          {term.trim() ? <span className="muted"> · {term.trim()}</span> : null}
        </div>
      )}
      {err && <p className="error">{err}</p>}
      <button className="btn btn-primary" disabled={busy || !canSubmit} style={{ width: "100%" }}>
        {busy ? "Oluşturuluyor…" : "Sınıf oluştur"}
      </button>
    </form>
  );
}
