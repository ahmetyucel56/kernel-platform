import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "../../api/client";
import type { ClassOut, Course, Department, OverviewClass, TeachingOverview } from "../../api/types";
import { useAuth } from "../../auth/AuthContext";
import { ClassAiModal } from "../../components/review/ClassAiModal";
import { IconAlert, IconCheck, IconPlus, IconSparkle, IconX } from "../../components/icons";

/** Sınıf sayfasında "Ödev ver" formunu açık getirir. */
const giveAssignmentUrl = (classId: string, courseId?: string) =>
  `/sinif/${classId}?yeni=1${courseId ? `&ders=${courseId}` : ""}`;
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
  const [picking, setPicking] = useState(false); // "Ödev ver": hangi sınıfa?

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
  const giveAssignment = () => {
    const classes = ov?.classes ?? [];
    if (classes.length === 0) setCreating(true);
    else if (classes.length === 1) navigate(giveAssignmentUrl(classes[0].id));
    else setPicking(true);
  };

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
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={() => setCreating(true)}>
            <IconPlus />
            Yeni sınıf
          </button>
          <button className="btn btn-primary" onClick={giveAssignment}>
            <IconPlus />
            Ödev ver
          </button>
        </div>
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
              <p className="muted" style={{ marginTop: 0 }}>
                Henüz sınıfın yok. Bölümün için bir kez sınıf oluştur (ör. Bilgisayar Programcılığı); sonra
                derslerini ekleyip ödevleri o sınıfa verirsin.
              </p>
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
                        {[u.class_name, u.course_name].filter(Boolean).join(" · ")} · {u.submitted}/{u.enrolled} teslim
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

      {picking && ov && (
        <div className="modal-backdrop" onClick={() => setPicking(false)}>
          <div className="modal" role="dialog" aria-label="Ödev ver" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <b style={{ fontFamily: "var(--font-display)", fontSize: 18 }}>Hangi sınıfa ödev vereceksin?</b>
              <button className="btn btn-ghost icon-btn btn-icon-only" aria-label="Kapat" onClick={() => setPicking(false)}>
                <IconX />
              </button>
            </div>
            <div className="modal-body stack" style={{ gap: 8 }}>
              {ov.classes.map((c) => (
                <button
                  key={c.id}
                  className="asg-item"
                  onClick={() => navigate(giveAssignmentUrl(c.id))}
                  style={{ textAlign: "left" }}
                >
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{c.name}</div>
                  <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>
                    {c.courses.length ? c.courses.map((x) => x.name).join(", ") : "Henüz ders eklenmedi"} · {c.student_count} öğrenci
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

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
                onDone={(id) => {
                  setCreating(false);
                  navigate(`/sinif/${id}`);
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
      body: "Bölümünü seç (ör. Bilgisayar Programcılığı) ve verdiğin dersleri ekle. Bir kez yapılır.",
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
      body: "Dersi seç, ödev metnini yapıştır; AI kurallara ayırsın, teslim tarihini belirle.",
      action: hasClass && !hasAssignment && firstClass && (
        <Link className="btn btn-sm" to={giveAssignmentUrl(firstClass.id)}>
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
  // Önce açık ödevler (en yakın tarih), sonra bitenler
  const sorted = [...c.assignments].sort((a, b) =>
    a.open !== b.open ? (a.open ? -1 : 1) : a.open ? a.effective_deadline_at.localeCompare(b.effective_deadline_at) : 0
  );
  const shown = sorted.slice(0, 4);
  const sub = [
    c.department_name && c.department_name !== c.name ? c.department_name : null,
    c.term,
    `${c.student_count} öğrenci`,
  ].filter(Boolean);
  return (
    <article className="card" style={{ padding: "18px 20px" }}>
      <div className="row between" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
        <Link to={`/sinif/${c.id}`} style={{ color: "inherit", minWidth: 0 }}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 20 }}>{c.name}</div>
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>{sub.join(" · ")}</div>
        </Link>
        <button className="ai-btn" title="AI sınıf özeti" onClick={onAi}>
          <IconSparkle size={14} />
          AI özeti
        </button>
      </div>

      <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 10 }}>
        {c.courses.length === 0 ? (
          <span className="faint" style={{ fontSize: 12.5 }}>Henüz ders eklenmedi</span>
        ) : (
          c.courses.map((co) => (
            <Link key={co.id} to={`/sinif/${c.id}?ders=${co.id}`} className="chip" style={{ color: "var(--muted)" }}>
              {co.name}
            </Link>
          ))
        )}
      </div>

      {shown.length > 0 ? (
        <div style={{ marginTop: 12, borderTop: "1px solid var(--line)" }}>
          {shown.map((a) => (
            <Link
              key={a.id}
              to={`/sinif/${c.id}?odev=${a.id}`}
              className="row between"
              style={{ color: "inherit", padding: "10px 0", borderBottom: "1px solid var(--line)", gap: 10 }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {a.title}
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {[a.course_name, a.submission_kind === "document" ? "Rapor / belge" : null].filter(Boolean).join(" · ")}
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: a.open ? "var(--gold)" : "var(--muted)" }}>
                  {a.open ? `${timeLeft(a.effective_deadline_at)} kaldı` : "Süre doldu"}
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {a.submitted}/{a.enrolled} teslim
                  {a.needs_review > 0 ? ` · ${a.needs_review} notlanmadı` : ""}
                </div>
              </div>
            </Link>
          ))}
          {c.assignments.length > shown.length && (
            <Link to={`/sinif/${c.id}`} className="muted" style={{ display: "block", fontSize: 12.5, paddingTop: 8 }}>
              Tüm ödevler ({c.assignments.length})
            </Link>
          )}
        </div>
      ) : (
        <p className="muted" style={{ fontSize: 13, margin: "12px 0 0" }}>Bu sınıfa henüz ödev vermedin.</p>
      )}

      <div className="row" style={{ gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        <Link className="btn btn-primary btn-sm" to={giveAssignmentUrl(c.id)}>
          <IconPlus size={14} />
          Bu sınıfa ödev ver
        </Link>
        <Link className="btn btn-sm" to={`/sinif/${c.id}`}>
          Sınıfa gir
        </Link>
      </div>
    </article>
  );
}

const NEW_DEP = "__new_dep__";

function CreateClassFlow({
  departments,
  courses,
  onDone,
}: {
  departments: Department[];
  courses: Course[];
  onDone: (classId: string) => void;
}) {
  const [deps, setDeps] = useState<Department[]>(departments);
  const [addingDep, setAddingDep] = useState(false);
  const [newDep, setNewDep] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [term, setTerm] = useState("");
  const [picked, setPicked] = useState<string[]>([]); // var olan dersler
  const [newCourses, setNewCourses] = useState<string[]>([]); // yeni ders adları
  const [newCourse, setNewCourse] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const deptCourses = useMemo(() => courses.filter((c) => c.department_id === departmentId), [courses, departmentId]);
  const deptName = deps.find((d) => d.id === departmentId)?.name ?? "";

  function chooseDepartment(id: string, list: Department[] = deps) {
    if (id === NEW_DEP) {
      setAddingDep(true);
      return;
    }
    setDepartmentId(id);
    setPicked([]);
    // Sınıf adı varsayılan olarak bölüm adı (hoca "1. sınıf", "A şubesi" ekleyebilir)
    if (!nameTouched) setName(list.find((d) => d.id === id)?.name ?? "");
  }

  async function createDepartment() {
    if (!newDep.trim()) return;
    setErr(null);
    try {
      const d = await api<Department>("/departments", { method: "POST", body: { name: newDep.trim() } });
      const list = deps.some((x) => x.id === d.id) ? deps : [...deps, d].sort((a, b) => a.name.localeCompare(b.name, "tr"));
      setDeps(list);
      setAddingDep(false);
      setNewDep("");
      chooseDepartment(d.id, list);
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "Bölüm eklenemedi.");
    }
  }

  function addNewCourse() {
    const n = newCourse.trim();
    if (!n) return;
    const existing = deptCourses.find((c) => c.name.toLocaleLowerCase("tr") === n.toLocaleLowerCase("tr"));
    if (existing) setPicked((p) => (p.includes(existing.id) ? p : [...p, existing.id]));
    else setNewCourses((l) => (l.includes(n) ? l : [...l, n]));
    setNewCourse("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const created = await api<ClassOut>("/classes", {
        method: "POST",
        body: { department_id: departmentId, name: name.trim(), term: term.trim() || null, course_ids: picked },
      });
      for (const n of newCourses) {
        await api(`/classes/${created.id}/courses`, { method: "POST", body: { name: n } });
      }
      onDone(created.id);
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "Oluşturulamadı.");
    } finally {
      setBusy(false);
    }
  }

  const courseCount = picked.length + newCourses.length;

  return (
    <form onSubmit={submit}>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Sınıf bir kez oluşturulur; öğrencileri bir kez eklersin. Verdiğin dersleri şimdi ya da sonra ekleyebilirsin,
        ödevi verirken dersi seçersin.
      </p>
      <div className="field">
        <label>Bölüm</label>
        {!addingDep ? (
          <select value={departmentId} onChange={(e) => chooseDepartment(e.target.value)} required>
            <option value="">Seç…</option>
            {deps.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
            <option value={NEW_DEP}>+ Listede yok, bölüm ekle…</option>
          </select>
        ) : (
          <div className="row" style={{ gap: 6 }}>
            <input
              autoFocus
              value={newDep}
              onChange={(e) => setNewDep(e.target.value)}
              placeholder="Bölüm adı (ör. Elektrik)"
              aria-label="Yeni bölüm adı"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  createDepartment();
                }
              }}
            />
            <button type="button" className="btn btn-primary btn-sm" onClick={createDepartment} disabled={!newDep.trim()}>
              Ekle
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAddingDep(false)}>
              Vazgeç
            </button>
          </div>
        )}
      </div>
      <div className="field">
        <label>Sınıf adı</label>
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setNameTouched(true);
          }}
          placeholder="Bilgisayar Programcılığı 1. sınıf"
          required
        />
        <p className="faint" style={{ fontSize: 12, margin: "6px 0 0" }}>
          Aynı bölümde birden çok grubun varsa ayırt edici ekle (ör. "1. sınıf", "A şubesi").
        </p>
      </div>
      <div className="field">
        <label>Dönem (opsiyonel)</label>
        <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="2025-Güz" />
      </div>

      {departmentId && (
        <div className="field">
          <label>Bu sınıfta verdiğin dersler (opsiyonel)</label>
          {deptCourses.length > 0 && (
            <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
              {deptCourses.map((co) => {
                const on = picked.includes(co.id);
                return (
                  <button
                    type="button"
                    key={co.id}
                    className={"chip chip-btn" + (on ? " on" : "")}
                    aria-pressed={on}
                    onClick={() => setPicked((p) => (on ? p.filter((x) => x !== co.id) : [...p, co.id]))}
                  >
                    {on && <IconCheck size={12} />}
                    {co.name}
                  </button>
                );
              })}
            </div>
          )}
          {newCourses.length > 0 && (
            <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
              {newCourses.map((n) => (
                <span key={n} className="chip chip-btn on">
                  {n}
                  <button type="button" className="chip-x" aria-label={`${n} dersini kaldır`} onClick={() => setNewCourses((l) => l.filter((x) => x !== n))}>
                    <IconX size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="row" style={{ gap: 6 }}>
            <input
              value={newCourse}
              onChange={(e) => setNewCourse(e.target.value)}
              placeholder={deptCourses.length ? "Listede yoksa ders adını yaz" : "Ders adı (ör. Mesleki Çözümleme I)"}
              aria-label="Yeni ders adı"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addNewCourse();
                }
              }}
            />
            <button type="button" className="btn btn-sm" onClick={addNewCourse} disabled={!newCourse.trim()}>
              Ekle
            </button>
          </div>
        </div>
      )}

      {departmentId && name.trim() && (
        <div className="panel" style={{ padding: "10px 12px", marginBottom: 16, fontSize: 13 }}>
          <span className="muted">Oluşacak sınıf: </span>
          <b>{name.trim()}</b>
          <span className="muted">
            {name.trim() !== deptName ? ` · ${deptName}` : ""}
            {term.trim() ? ` · ${term.trim()}` : ""} · {courseCount ? `${courseCount} ders` : "ders sonra eklenecek"}
          </span>
        </div>
      )}
      {err && <p className="error">{err}</p>}
      <button className="btn btn-primary" disabled={busy || !departmentId || !name.trim()} style={{ width: "100%" }}>
        {busy ? "Oluşturuluyor…" : "Sınıf oluştur"}
      </button>
    </form>
  );
}
