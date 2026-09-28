import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import {
  api,
  ApiError,
  type Course,
  type Department,
} from "../../src/api";
import { BackHeader, Btn, Card, Loader, Muted, Screen, Select, form } from "../../src/ui";
import { colors, fonts, radius } from "../../src/theme";

const NEW_COURSE = "+ Yeni ders oluştur…";

export default function NewClass() {
  const router = useRouter();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);

  const [deptName, setDeptName] = useState("");
  const [courseSel, setCourseSel] = useState(""); // ders adı | NEW_COURSE
  const [newCourseName, setNewCourseName] = useState("");
  const [newCourseCode, setNewCourseCode] = useState("");
  const [section, setSection] = useState("");
  const [term, setTerm] = useState("");
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

  const departmentId = useMemo(
    () => departments.find((d) => d.name === deptName)?.id ?? "",
    [departments, deptName]
  );
  const deptCourses = useMemo(
    () => courses.filter((c) => c.department_id === departmentId),
    [courses, departmentId]
  );
  const creatingNew = courseSel === NEW_COURSE;
  const selectedCourseName = creatingNew
    ? newCourseName.trim()
    : deptCourses.find((c) => c.name === courseSel)?.name ?? "";
  const generatedName = selectedCourseName
    ? section.trim()
      ? `${selectedCourseName} - ${section.trim()} Şubesi`
      : selectedCourseName
    : "";

  async function save() {
    setErr(null);
    if (!departmentId) return setErr("Bölüm seç.");
    if (!selectedCourseName) return setErr("Ders seç veya yeni ders adı gir.");
    setSaving(true);
    try {
      let courseId = deptCourses.find((c) => c.name === courseSel)?.id ?? "";
      if (creatingNew) {
        const created = await api<Course>("/courses", {
          method: "POST",
          body: {
            department_id: departmentId,
            name: newCourseName.trim(),
            code: newCourseCode.trim() || null,
          },
        });
        courseId = created.id;
      }
      await api("/classes", {
        method: "POST",
        body: { course_id: courseId, name: generatedName, term: term.trim() || null },
      });
      router.back();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Sınıf oluşturulamadı.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Loader />;

  return (
    <Screen>
      <BackHeader />
      <Text style={{ color: colors.ink, fontSize: 26, fontFamily: fonts.display, marginBottom: 6 }}>
        Yeni sınıf
      </Text>
      <Muted style={{ marginBottom: 16 }}>
        Bölüm ve ders seç; sınıf adı otomatik oluşur. Tek grubun varsa şubeyi boş bırak.
      </Muted>

      {departments.length === 0 ? (
        <Card>
          <Muted>
            Sistemde bölüm tanımlı değil. Bölüm ekleme yönetici (admin) işidir; demo verisinde
            bir bölüm mevcut olmalı.
          </Muted>
        </Card>
      ) : (
        <Card>
          <Select
            label="Bölüm"
            value={deptName}
            options={departments.map((d) => d.name)}
            onChange={(v) => {
              setDeptName(v);
              setCourseSel("");
            }}
            placeholder="Bölüm seç…"
          />

          <Select
            label="Ders"
            value={courseSel}
            options={[...deptCourses.map((c) => c.name), ...(departmentId ? [NEW_COURSE] : [])]}
            onChange={setCourseSel}
            placeholder={departmentId ? "Ders seç…" : "Önce bölüm seç"}
          />

          {creatingNew && (
            <View
              style={{
                backgroundColor: colors.bg3,
                borderColor: colors.line,
                borderWidth: 1,
                borderRadius: radius.sm,
                padding: 12,
                marginBottom: 14,
              }}
            >
              <Text style={s.label}>Yeni ders adı</Text>
              <TextInput
                value={newCourseName}
                onChangeText={setNewCourseName}
                placeholder="Web Programlama II"
                placeholderTextColor={colors.faint}
                style={s.input}
              />
              <Text style={[s.label, { marginTop: 10 }]}>Ders kodu (opsiyonel)</Text>
              <TextInput
                value={newCourseCode}
                onChangeText={setNewCourseCode}
                placeholder="WEB202"
                placeholderTextColor={colors.faint}
                style={s.input}
              />
            </View>
          )}

          <Text style={s.label}>Şube / grup (opsiyonel)</Text>
          <TextInput
            value={section}
            onChangeText={setSection}
            placeholder="Tek grup varsa boş bırak (ör: A)"
            placeholderTextColor={colors.faint}
            style={s.input}
          />

          <Text style={[s.label, { marginTop: 14 }]}>Dönem (opsiyonel)</Text>
          <TextInput
            value={term}
            onChangeText={setTerm}
            placeholder="2025-Güz"
            placeholderTextColor={colors.faint}
            style={s.input}
          />

          {generatedName ? (
            <View
              style={{
                backgroundColor: colors.bg3,
                borderRadius: radius.sm,
                padding: 10,
                marginTop: 14,
              }}
            >
              <Text style={{ color: colors.muted, fontSize: 13 }}>
                Oluşacak sınıf: <Text style={{ color: colors.ink, fontWeight: "700" }}>{generatedName}</Text>
                {term.trim() ? ` · ${term.trim()}` : ""}
              </Text>
            </View>
          ) : null}

          {err && <Text style={{ color: colors.danger, fontSize: 13, marginTop: 12 }}>{err}</Text>}

          <View style={{ marginTop: 16 }}>
            <Btn
              title={saving ? "Oluşturuluyor…" : "Sınıf oluştur"}
              variant="gold"
              onPress={save}
              disabled={saving}
            />
          </View>
        </Card>
      )}
    </Screen>
  );
}

const s = form;
