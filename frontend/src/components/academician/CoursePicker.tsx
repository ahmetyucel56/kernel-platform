import { useState } from "react";
import { api, ApiError } from "../../api/client";
import type { ClassOut, Course } from "../../api/types";

const NEW = "__new__";

/** Ödevin dersi: sınıfın derslerinden seçilir; listede yoksa buradan sınıfa yeni ders eklenir. */
export function CoursePicker({
  classId,
  courses,
  value,
  onChange,
  onClassChanged,
}: {
  classId: string;
  courses: Course[];
  value: string;
  onChange: (id: string) => void;
  onClassChanged: (c: ClassOut) => void;
}) {
  const [adding, setAdding] = useState(courses.length === 0);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const cls = await api<ClassOut>(`/classes/${classId}/courses`, { method: "POST", body: { name: name.trim() } });
      onClassChanged(cls);
      const created = cls.courses.find((c) => c.name.toLocaleLowerCase("tr") === name.trim().toLocaleLowerCase("tr"));
      if (created) onChange(created.id);
      setName("");
      setAdding(false);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Ders eklenemedi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field">
      <label>Ders</label>
      {!adding ? (
        <select
          value={value}
          onChange={(e) => (e.target.value === NEW ? setAdding(true) : onChange(e.target.value))}
          required
        >
          {courses.length > 1 && <option value="">Hangi ders? Seç…</option>}
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.code ? ` (${c.code})` : ""}
            </option>
          ))}
          <option value={NEW}>+ Sınıfa yeni ders ekle…</option>
        </select>
      ) : (
        <div className="panel" style={{ padding: 12 }}>
          <div className="row" style={{ gap: 8 }}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Mesleki Çözümleme I"
              aria-label="Yeni ders adı"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
            />
            <button type="button" className="btn btn-primary btn-sm" onClick={add} disabled={busy || !name.trim()}>
              {busy ? "…" : "Ekle"}
            </button>
            {courses.length > 0 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>
                Vazgeç
              </button>
            )}
          </div>
          <p className="faint" style={{ fontSize: 12, margin: "6px 0 0" }}>
            {courses.length === 0 ? "Bu sınıfta henüz ders yok. Bu ödevin dersini yaz; ders sınıfa eklenir." : "Ders sınıfa eklenir, sonraki ödevlerde de seçebilirsin."}
          </p>
          {err && <p className="error" style={{ margin: "6px 0 0" }}>{err}</p>}
        </div>
      )}
    </div>
  );
}
