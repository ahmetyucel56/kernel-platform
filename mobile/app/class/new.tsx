import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { api, ApiError, type ClassOut, type Course, type Department } from "../../src/api";
import { BackHeader, Btn, Card, Icon, Loader, Muted, Screen, Select, form } from "../../src/ui";
import { colors, fonts, radius } from "../../src/theme";

const NEW_DEP = "+ Listede yok, bölüm ekle…";

/** Sınıf = bölüm grubu (web'deki CreateClassFlow ile aynı): bölüm, sınıf adı, isteğe bağlı dersler. */
export default function NewClass() {
  const router = useRouter();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);

  const [departmentId, setDepartmentId] = useState("");
  const [addingDep, setAddingDep] = useState(false);
  const [newDep, setNewDep] = useState("");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [term, setTerm] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [newCourses, setNewCourses] = useState<string[]>([]);
  const [newCourse, setNewCourse] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api<Department[]>("/departments"), api<Course[]>("/courses")])
      .then(([deps, crs]) => {
        setDepartments(deps);
        setCourses(crs);
      })
      .catch(() => setErr("Bölüm/ders yüklenemedi."))
      .finally(() => setLoading(false));
  }, []);

  const deptCourses = useMemo(() => courses.filter((c) => c.department_id === departmentId), [courses, departmentId]);
  const deptName = departments.find((d) => d.id === departmentId)?.name ?? "";

  function chooseDepartment(id: string, list: Department[] = departments) {
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
      const list = departments.some((x) => x.id === d.id) ? departments : [...departments, d];
      setDepartments(list);
      setAddingDep(false);
      setNewDep("");
      chooseDepartment(d.id, list);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Bölüm eklenemedi.");
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

  async function save() {
    setErr(null);
    if (!departmentId) return setErr("Bölüm seç.");
    if (!name.trim()) return setErr("Sınıf adı gerekli.");
    setSaving(true);
    try {
      const created = await api<ClassOut>("/classes", {
        method: "POST",
        body: { department_id: departmentId, name: name.trim(), term: term.trim() || null, course_ids: picked },
      });
      for (const n of newCourses) {
        await api(`/classes/${created.id}/courses`, { method: "POST", body: { name: n } });
      }
      router.replace({ pathname: "/class/[id]", params: { id: created.id } });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Sınıf oluşturulamadı.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Loader />;
  const courseCount = picked.length + newCourses.length;

  return (
    <Screen>
      <BackHeader />
      <Text style={{ color: colors.ink, fontSize: 26, fontFamily: fonts.display, marginBottom: 6 }}>Yeni sınıf</Text>
      <Muted style={{ marginBottom: 16 }}>
        Sınıf bir kez oluşturulur; öğrencileri bir kez eklersin. Verdiğin dersleri şimdi ya da sonra ekleyebilirsin,
        ödevi verirken dersi seçersin.
      </Muted>

      <Card>
        {!addingDep ? (
          <Select
            label="Bölüm"
            value={deptName}
            options={[...departments.map((d) => d.name), NEW_DEP]}
            onChange={(v) => {
              if (v === NEW_DEP) return setAddingDep(true);
              const d = departments.find((x) => x.name === v);
              if (d) chooseDepartment(d.id);
            }}
            placeholder="Bölüm seç…"
          />
        ) : (
          <View style={{ marginBottom: 14 }}>
            <Text style={s.label}>Yeni bölüm</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TextInput
                value={newDep}
                onChangeText={setNewDep}
                placeholder="Bölüm adı (ör. Elektrik)"
                placeholderTextColor={colors.faint}
                style={[s.input, { flex: 1 }]}
                onSubmitEditing={createDepartment}
              />
              <Btn title="Ekle" variant="primary" onPress={createDepartment} disabled={!newDep.trim()} />
            </View>
            <Text onPress={() => setAddingDep(false)} style={{ color: colors.blueSoft, fontSize: 13, marginTop: 8 }}>
              Vazgeç
            </Text>
          </View>
        )}

        <Text style={s.label}>Sınıf adı</Text>
        <TextInput
          value={name}
          onChangeText={(v) => {
            setName(v);
            setNameTouched(true);
          }}
          placeholder="Bilgisayar Programcılığı 1. sınıf"
          placeholderTextColor={colors.faint}
          style={s.input}
        />
        <Muted style={{ fontSize: 12, marginTop: 6 }}>
          Aynı bölümde birden çok grubun varsa ayırt edici ekle (ör. "1. sınıf", "A şubesi").
        </Muted>

        <Text style={[s.label, { marginTop: 14 }]}>Dönem (opsiyonel)</Text>
        <TextInput value={term} onChangeText={setTerm} placeholder="2025-Güz" placeholderTextColor={colors.faint} style={s.input} />

        {departmentId ? (
          <>
            <Text style={[s.label, { marginTop: 14 }]}>Bu sınıfta verdiğin dersler (opsiyonel)</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {deptCourses.map((co) => {
                const on = picked.includes(co.id);
                return (
                  <Pressable
                    key={co.id}
                    onPress={() => setPicked((p) => (on ? p.filter((x) => x !== co.id) : [...p, co.id]))}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    style={chipStyle(on)}
                  >
                    {on && <Icon name="check" size={12} color={colors.gold} />}
                    <Text style={{ color: on ? colors.gold : colors.muted, fontSize: 13 }}>{co.name}</Text>
                  </Pressable>
                );
              })}
              {newCourses.map((n) => (
                <Pressable
                  key={n}
                  onPress={() => setNewCourses((l) => l.filter((x) => x !== n))}
                  accessibilityLabel={`${n} dersini kaldır`}
                  style={chipStyle(true)}
                >
                  <Text style={{ color: colors.gold, fontSize: 13 }}>{n}</Text>
                  <Icon name="x" size={12} color={colors.gold} />
                </Pressable>
              ))}
            </View>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
              <TextInput
                value={newCourse}
                onChangeText={setNewCourse}
                placeholder={deptCourses.length ? "Listede yoksa ders adını yaz" : "Ders adı (ör. Mesleki Çözümleme I)"}
                placeholderTextColor={colors.faint}
                style={[s.input, { flex: 1 }]}
                onSubmitEditing={addNewCourse}
              />
              <Btn title="Ekle" variant="ghost" onPress={addNewCourse} disabled={!newCourse.trim()} />
            </View>
          </>
        ) : null}

        {departmentId && name.trim() ? (
          <View style={{ backgroundColor: colors.bg3, borderRadius: radius.sm, padding: 10, marginTop: 14 }}>
            <Text style={{ color: colors.muted, fontSize: 13 }}>
              Oluşacak sınıf: <Text style={{ color: colors.ink, fontWeight: "700" }}>{name.trim()}</Text>
              {name.trim() !== deptName ? ` · ${deptName}` : ""}
              {term.trim() ? ` · ${term.trim()}` : ""} · {courseCount ? `${courseCount} ders` : "ders sonra eklenecek"}
            </Text>
          </View>
        ) : null}

        {err && <Text style={{ color: colors.danger, fontSize: 13, marginTop: 12 }}>{err}</Text>}

        <View style={{ marginTop: 16 }}>
          <Btn title={saving ? "Oluşturuluyor…" : "Sınıf oluştur"} variant="gold" onPress={save} disabled={saving} />
        </View>
      </Card>
    </Screen>
  );
}

const s = form;
// Tema değişince renkler güncellensin diye her çizimde hesaplanır
function chipStyle(on: boolean) {
  return {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 5,
    borderWidth: 1,
    borderColor: on ? colors.goldDim : colors.line2,
    backgroundColor: on ? colors.goldBg : "transparent",
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
  };
}
