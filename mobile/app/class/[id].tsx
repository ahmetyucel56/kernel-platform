import { useCallback, useMemo, useState } from "react";
import { Alert, Linking, Pressable, ScrollView, Share, Text, TextInput, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import {
  api,
  ApiError,
  type Assignment,
  type ClassGrades,
  type ClassOut,
  type OverviewAssignment,
  type TeachingOverview,
  type User,
} from "../../src/api";
import {
  AiChip,
  BackHeader,
  Btn,
  Card,
  Chip,
  form,
  Icon,
  IconButton,
  Loader,
  Muted,
  ProgressBar,
  Screen,
  Segmented,
  Tag,
} from "../../src/ui";
import { ClassAiSheet } from "../../src/ClassAiSheet";
import { API_BASE_URL } from "../../src/config";
import { colors, fonts } from "../../src/theme";
import { dueOf, fmtDateTime, isExtended, isPast, timeLeft } from "../../src/format";

type Tab = "odevler" | "ogrenciler" | "notlar";

export default function ClassDetail() {
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [cls, setCls] = useState<ClassOut | null>(null);
  const [students, setStudents] = useState<User[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [stats, setStats] = useState<Record<string, OverviewAssignment>>({});
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("odevler");
  const [ai, setAi] = useState<{ open: boolean; studentId?: string }>({ open: false });
  const [courseFilter, setCourseFilter] = useState(""); // "" = tüm dersler
  const [renaming, setRenaming] = useState<string | null>(null);
  const courses = cls?.courses ?? [];
  const shown = useMemo(
    () => (courseFilter ? assignments.filter((a) => a.course_id === courseFilter) : assignments),
    [assignments, courseFilter]
  );

  const load = useCallback(async () => {
    try {
      const [clsList, studs, asgs, ov] = await Promise.all([
        api<ClassOut[]>("/classes"),
        api<User[]>(`/classes/${id}/students`),
        api<Assignment[]>(`/assignments?class_id=${id}`),
        api<TeachingOverview>("/me/teaching-overview"),
      ]);
      setCls(clsList.find((c) => c.id === id) ?? null);
      setStudents(studs);
      setAssignments(asgs);
      const mine = ov.classes.find((c) => c.id === id);
      setStats(Object.fromEntries((mine?.assignments ?? []).map((a) => [a.id, a])));
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Ekrana her dönüşte tazele (ödev ekleyip geri gelince güncel olsun)
  useFocusEffect(
    useCallback(() => {
      if (id) load();
    }, [id, load])
  );

  // Not dosyası: 5 dk geçerli, bu sınıfa özel imzalı link tarayıcıda açılır.
  const [exporting, setExporting] = useState(false);
  async function exportGrades() {
    setExporting(true);
    try {
      const { url } = await api<{ url: string }>(`/classes/${id}/gradebook-link`, { method: "POST" });
      await Linking.openURL(`${API_BASE_URL}${url}`);
    } catch (e) {
      Alert.alert("Hata", e instanceof ApiError ? e.message : "Not dosyası hazırlanamadı.");
    } finally {
      setExporting(false);
    }
  }

  function moreMenu() {
    Alert.alert(cls?.name ?? "Sınıf", undefined, [
      { text: "Vazgeç", style: "cancel" },
      { text: "Sınıfın adını değiştir", onPress: () => setRenaming(cls?.name ?? "") },
      { text: "Sınıfı sil", style: "destructive", onPress: deleteClass },
    ]);
  }

  async function saveName() {
    const name = (renaming ?? "").trim();
    if (!name) return;
    try {
      setCls(await api<ClassOut>(`/classes/${id}`, { method: "PATCH", body: { name } }));
      setRenaming(null);
    } catch (e) {
      Alert.alert("Hata", e instanceof ApiError ? e.message : "Ad değiştirilemedi.");
    }
  }

  function deleteClass() {
    Alert.alert("Sınıfı sil", `"${cls?.name ?? "Sınıf"}" silinecek. Emin misin?`, [
      { text: "Vazgeç", style: "cancel" },
      {
        text: "Sil",
        style: "destructive",
        onPress: async () => {
          try {
            await api(`/classes/${id}`, { method: "DELETE" });
            router.back();
          } catch (e) {
            Alert.alert("Hata", e instanceof ApiError ? e.message : "Silinemedi.");
          }
        },
      },
    ]);
  }

  if (loading) return <Loader />;

  return (
    <Screen>
      <BackHeader right={<IconButton name="more-horizontal" label="Diğer işlemler" onPress={moreMenu} />} />

      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Text style={{ color: colors.ink, fontSize: 24, fontFamily: fonts.display, flexShrink: 1 }}>{cls?.name ?? "Sınıf"}</Text>
        {cls?.term ? <Tag text={cls.term} /> : null}
      </View>
      {cls?.department_name && cls.department_name !== cls.name ? (
        <Muted style={{ fontSize: 13, marginTop: 2 }}>{cls.department_name}</Muted>
      ) : null}
      {renaming !== null && (
        <Card style={{ marginTop: 10 }}>
          <Text style={form.label}>Sınıfın yeni adı</Text>
          <TextInput
            value={renaming}
            onChangeText={setRenaming}
            placeholder="Bilgisayar Programcılığı 1. sınıf"
            placeholderTextColor={colors.faint}
            style={form.input}
          />
          <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
            <Btn small title="Kaydet" variant="gold" onPress={saveName} disabled={!renaming.trim()} />
            <Btn small title="Vazgeç" variant="ghost" onPress={() => setRenaming(null)} />
          </View>
        </Card>
      )}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 14, marginBottom: 16 }}>
        <View style={{ flex: 1 }}>
          <Btn title="AI özeti" icon="sparkle" variant="gold" onPress={() => setAi({ open: true })} />
        </View>
        <View style={{ flex: 1 }}>
          <Btn
            title={exporting ? "Hazırlanıyor…" : "Excel'e aktar"}
            icon="download"
            variant="ghost"
            onPress={exportGrades}
            disabled={exporting}
          />
        </View>
      </View>
      <ClassAiSheet
        visible={ai.open}
        classId={id}
        className={cls?.name ?? "Sınıf"}
        studentId={ai.studentId}
        onClose={() => setAi({ open: false })}
      />

      {cls && (
        <CourseBar
          cls={cls}
          assignments={assignments}
          value={courseFilter}
          onChange={setCourseFilter}
          onClassChanged={setCls}
        />
      )}

      <Segmented<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { key: "odevler", label: `Ödevler ${assignments.length}` },
          { key: "ogrenciler", label: `Öğrenciler ${students.length}` },
          { key: "notlar", label: "Notlar" },
        ]}
      />

      {tab === "odevler" && (
        <>
          <Pressable
            onPress={() =>
              router.push({ pathname: "/assignment/new", params: { classId: id, ...(courseFilter ? { courseId: courseFilter } : {}) } })
            }
            style={{
              borderWidth: 1,
              borderStyle: "dashed",
              borderColor: colors.line2,
              borderRadius: 12,
              minHeight: 44,
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 12,
            }}
          >
            <Text style={{ color: colors.ink, fontFamily: fonts.ui, fontSize: 13.5 }}>+ Ödev ver</Text>
          </Pressable>
          {shown.length === 0 ? (
            <Card>
              <Muted>{courseFilter ? "Bu derste henüz ödev yok." : "Bu sınıfta ödev yok."}</Muted>
            </Card>
          ) : (
            shown.map((a) => {
              const past = isPast(dueOf(a));
              const st = stats[a.id];
              const pct = st && st.enrolled ? (st.submitted / st.enrolled) * 100 : 0;
              return (
                <Pressable key={a.id} onPress={() => router.push({ pathname: "/assignment/[id]", params: { id: a.id } })}>
                  <Card>
                    <Text style={{ color: colors.ink, fontSize: 16, fontWeight: "700" }}>{a.title}</Text>
                    {courses.length > 1 && !courseFilter && a.course_name ? (
                      <Muted style={{ fontSize: 12.5, marginTop: 2 }}>{a.course_name}</Muted>
                    ) : null}
                    <View style={{ flexDirection: "row", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                      <Chip text={past ? "Süre doldu" : `Açık · ${timeLeft(dueOf(a))}`} kind={past ? "muted" : "gold"} />
                      {st && (
                        <Muted style={{ fontSize: 12.5 }}>
                          {st.submitted}/{st.enrolled} teslim
                          {st.needs_review ? ` · ${st.needs_review} notlanmadı` : ""}
                        </Muted>
                      )}
                    </View>
                    {st && (
                      <View style={{ marginTop: 10 }}>
                        <ProgressBar pct={pct} done={pct >= 100} />
                      </View>
                    )}
                    <Muted style={{ fontSize: 12, marginTop: 8 }}>
                      Teslim: {fmtDateTime(dueOf(a))}
                      {isExtended(a) ? " (uzatıldı)" : ""}
                    </Muted>
                  </Card>
                </Pressable>
              );
            })
          )}
        </>
      )}

      {tab === "ogrenciler" && (
        <StudentsTab classId={id} students={students} onChanged={load} onAi={(sid) => setAi({ open: true, studentId: sid })} />
      )}

      {tab === "notlar" && <GradesTab classId={id} courseId={courseFilter} />}
    </Screen>
  );
}

function StudentsTab({
  classId,
  students,
  onChanged,
  onAi,
}: {
  classId: string;
  students: User[];
  onChanged: () => void;
  onAi: (studentId: string) => void;
}) {
  const [studentNo, setStudentNo] = useState("");
  const [enrolling, setEnrolling] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function enroll() {
    const no = studentNo.trim();
    if (!no || enrolling) return;
    setMsg(null);
    setEnrolling(true);
    try {
      await api(`/classes/${classId}/enroll`, { method: "POST", body: { student_no: no } });
      setStudentNo("");
      setMsg({ kind: "ok", text: `${no} numaralı öğrenci eklendi.` });
      onChanged();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof ApiError ? e.message : "Eklenemedi." });
    } finally {
      setEnrolling(false);
    }
  }

  // Hocanın kendi öğrencisinin şifresini sıfırlaması: geçici şifre yalnızca bir kez gösterilir
  const [temp, setTemp] = useState<{ name: string; no: string | null; password: string } | null>(null);

  function resetPassword(s: User) {
    Alert.alert(
      "Şifre sıfırla",
      `${s.full_name} için geçici şifre oluşturulsun mu? Açık oturumları kapanır; ilk girişte kendi şifresini belirler.`,
      [
        { text: "Vazgeç", style: "cancel" },
        {
          text: "Sıfırla",
          style: "destructive",
          onPress: async () => {
            try {
              const r = await api<{ student_name: string; school_no: string | null; temp_password: string }>(
                `/classes/${classId}/students/${s.id}/reset-password`,
                { method: "POST" }
              );
              setTemp({ name: r.student_name, no: r.school_no, password: r.temp_password });
            } catch (e) {
              Alert.alert("Hata", e instanceof ApiError ? e.message : "Şifre sıfırlanamadı.");
            }
          },
        },
      ]
    );
  }

  function remove(s: User) {
    Alert.alert("Öğrenciyi çıkar", `${s.full_name} sınıftan çıkarılsın mı?`, [
      { text: "Vazgeç", style: "cancel" },
      {
        text: "Çıkar",
        style: "destructive",
        onPress: async () => {
          try {
            await api(`/classes/${classId}/students/${s.id}`, { method: "DELETE" });
            onChanged();
          } catch (e) {
            Alert.alert("Hata", e instanceof ApiError ? e.message : "Çıkarılamadı.");
          }
        },
      },
    ]);
  }

  return (
    <>
      <Card>
        <Text style={form.label}>Okul numarasıyla ekle</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TextInput
            value={studentNo}
            onChangeText={setStudentNo}
            placeholder="ör: 2025001"
            placeholderTextColor={colors.faint}
            keyboardType="number-pad"
            style={[form.input, { flex: 1 }]}
          />
          <Btn title={enrolling ? "…" : "Ekle"} variant="primary" onPress={enroll} disabled={enrolling || !studentNo.trim()} />
        </View>
        {msg && (
          <Text style={{ color: msg.kind === "ok" ? colors.ok : colors.danger, fontSize: 13, marginTop: 8 }}>{msg.text}</Text>
        )}
      </Card>
      {temp && (
        <Card style={{ borderColor: colors.gold }}>
          <Text style={{ color: colors.ink, fontSize: 14.5 }}>
            Şifre sıfırlandı: {temp.name}
            {temp.no ? ` (${temp.no})` : ""}
          </Text>
          <Muted style={{ fontSize: 12.5, marginVertical: 6 }}>
            Geçici şifre yalnızca şimdi gösteriliyor; öğrenciye yüz yüze ya da güvenli bir kanaldan ilet. İlk girişte
            kendi şifresini belirleyecek.
          </Muted>
          <Text selectable style={{ color: colors.ink, fontSize: 20, letterSpacing: 1, marginBottom: 10 }}>
            {temp.password}
          </Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Btn small variant="ghost" icon="share" title="Paylaş"
              onPress={() => Share.share({ message: temp.password }).catch(() => {})} />
            <Btn small title="Tamam" onPress={() => setTemp(null)} />
          </View>
        </Card>
      )}
      <Card style={{ paddingVertical: 4 }}>
        {students.length === 0 ? (
          <Muted style={{ paddingVertical: 10 }}>Henüz öğrenci yok.</Muted>
        ) : (
          students.map((s, i) => (
            <View
              key={s.id}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                paddingVertical: 10,
                borderTopWidth: i ? 1 : 0,
                borderTopColor: colors.line,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.ink, fontSize: 14.5 }}>{s.full_name}</Text>
                {s.school_no ? <Muted style={{ fontSize: 12 }}>No: {s.school_no}</Muted> : null}
              </View>
              <AiChip onPress={() => onAi(s.id)} />
              {!s.is_demo && (
                <Pressable onPress={() => resetPassword(s)} hitSlop={6} style={{ padding: 6 }}
                  accessibilityLabel="Şifre sıfırla">
                  <Icon name="key" size={16} color={colors.muted} />
                </Pressable>
              )}
              <Pressable onPress={() => remove(s)} hitSlop={6} style={{ padding: 6 }}>
                <Text style={{ color: colors.danger, fontSize: 12.5 }}>Çıkar</Text>
              </Pressable>
            </View>
          ))
        )}
      </Card>
    </>
  );
}

/** Not çizelgesi: web'deki "Not çizelgesi" sekmesiyle aynı veri. */
function GradesTab({ classId, courseId }: { classId: string; courseId: string }) {
  const [all, setG] = useState<ClassGrades | null>(null);
  // Seçili dersin ödevleri; ortalama da yalnızca o dersten (web ile aynı)
  const g = useMemo(() => {
    if (!all || !courseId) return all;
    const keep = all.assignments.map((a, i) => (a.course_id === courseId ? i : -1)).filter((i) => i >= 0);
    return {
      assignments: keep.map((i) => all.assignments[i]),
      rows: all.rows.map((r) => {
        const scores = keep.map((i) => r.scores[i]);
        const given = scores.filter((s): s is number => s != null);
        return {
          ...r,
          scores,
          statuses: keep.map((i) => r.statuses[i]),
          average: given.length ? Math.round((given.reduce((x, y) => x + y, 0) / given.length) * 10) / 10 : null,
        };
      }),
    };
  }, [all, courseId]);
  const [err, setErr] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      api<ClassGrades>(`/classes/${classId}/grades`)
        .then(setG)
        .catch((e) => setErr(e instanceof ApiError ? e.message : "Notlar yüklenemedi."));
    }, [classId])
  );

  if (err) return <Text style={{ color: colors.danger }}>{err}</Text>;
  if (!g) return <Muted>Yükleniyor…</Muted>;
  if (g.rows.length === 0)
    return (
      <Card>
        <Muted>Sınıfta öğrenci yok.</Muted>
      </Card>
    );

  const COL = 64;
  const cell = { width: COL, textAlign: "right" as const, fontSize: 13.5 };
  return (
    <>
      <Muted style={{ fontSize: 12.5, marginBottom: 10 }}>
        Her ödev için verdiğin en son not. Boş = not verilmemiş (0 sayılmaz).
        {courseId ? " Yalnızca seçili dersin ödevleri." : ""} Excel'de her ders ayrı sayfadadır.
      </Muted>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <ScrollView horizontal showsHorizontalScrollIndicator>
          <View>
            <View style={{ flexDirection: "row", backgroundColor: colors.bg3, paddingVertical: 9, paddingHorizontal: 12 }}>
              <Text style={{ width: 132, color: colors.muted, fontSize: 12, fontFamily: fonts.ui }}>Öğrenci</Text>
              {g.assignments.map((a) => (
                <Text key={a.id} style={[cell, { color: colors.muted, fontSize: 12, fontFamily: fonts.ui }]} numberOfLines={1}>
                  {a.title.split(":")[0]}
                </Text>
              ))}
              <Text style={[cell, { width: 60, color: colors.muted, fontSize: 12, fontFamily: fonts.ui }]}>Ort.</Text>
            </View>
            {g.rows.map((r) => (
              <View
                key={r.student.id}
                style={{ flexDirection: "row", paddingVertical: 10, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: colors.line }}
              >
                <View style={{ width: 132 }}>
                  <Text style={{ color: colors.ink, fontSize: 13.5 }} numberOfLines={1}>
                    {r.student.full_name}
                  </Text>
                  <Muted style={{ fontSize: 11 }}>{r.student.school_no ?? ""}</Muted>
                </View>
                {r.scores.map((s, i) => (
                  <Text
                    key={i}
                    style={[
                      cell,
                      { color: s != null ? colors.ink : r.statuses[i] === "none" ? colors.faint : colors.blueSoft },
                    ]}
                  >
                    {s ?? (r.statuses[i] === "none" ? "—" : "•")}
                  </Text>
                ))}
                <Text style={[cell, { width: 60, color: colors.ink, fontWeight: "700" }]}>{r.average ?? "—"}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </Card>
      <Muted style={{ fontSize: 11.5 }}>— teslim yok · • teslim var, notlanmadı</Muted>
    </>
  );
}

/** Sınıfın dersleri (web'deki CourseBar ile aynı): filtre + ders ekle; ödevsiz ders uzun basınca çıkarılır. */
function CourseBar({
  cls,
  assignments,
  value,
  onChange,
  onClassChanged,
}: {
  cls: ClassOut;
  assignments: Assignment[];
  value: string;
  onChange: (id: string) => void;
  onClassChanged: (c: ClassOut) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const count = (id: string) => assignments.filter((a) => a.course_id === id).length;

  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      onClassChanged(await api<ClassOut>(`/classes/${cls.id}/courses`, { method: "POST", body: { name: name.trim() } }));
      setName("");
      setAdding(false);
    } catch (e) {
      Alert.alert("Hata", e instanceof ApiError ? e.message : "Ders eklenemedi.");
    } finally {
      setBusy(false);
    }
  }

  function remove(id: string, courseName: string) {
    if (count(id) > 0) {
      Alert.alert(courseName, "Bu derste ödev var; önce ödevleri silmen ya da başka derse taşıman gerekir.");
      return;
    }
    Alert.alert("Dersi çıkar", `"${courseName}" bu sınıftan çıkarılsın mı?`, [
      { text: "Vazgeç", style: "cancel" },
      {
        text: "Çıkar",
        style: "destructive",
        onPress: async () => {
          try {
            onClassChanged(await api<ClassOut>(`/classes/${cls.id}/courses/${id}`, { method: "DELETE" }));
            if (value === id) onChange("");
          } catch (e) {
            Alert.alert("Hata", e instanceof ApiError ? e.message : "Ders çıkarılamadı.");
          }
        },
      },
    ]);
  }

  const pill = (on: boolean) => ({
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 5,
    borderWidth: 1,
    borderColor: on ? colors.goldDim : colors.line2,
    backgroundColor: on ? colors.goldBg : "transparent",
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
  });

  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ color: colors.muted, fontSize: 11.5, fontFamily: fonts.ui, letterSpacing: 1, marginBottom: 8 }}>DERSLER</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {cls.courses.length > 1 && (
          <Pressable onPress={() => onChange("")} style={pill(value === "")}>
            <Text style={{ color: value === "" ? colors.gold : colors.muted, fontSize: 13 }}>Tümü</Text>
          </Pressable>
        )}
        {cls.courses.map((co) => {
          const on = value === co.id;
          return (
            <Pressable
              key={co.id}
              onPress={() => onChange(on ? "" : co.id)}
              onLongPress={() => remove(co.id, co.name)}
              accessibilityHint="Uzun basınca dersi sınıftan çıkarır"
              style={pill(on)}
            >
              <Text style={{ color: on ? colors.gold : colors.muted, fontSize: 13 }}>{co.name}</Text>
              <Text style={{ color: colors.faint, fontSize: 12 }}>{count(co.id)}</Text>
            </Pressable>
          );
        })}
        {!adding && (
          <Pressable onPress={() => setAdding(true)} style={[pill(false), { borderStyle: "dashed" }]}>
            <Icon name="plus" size={12} color={colors.muted} />
            <Text style={{ color: colors.muted, fontSize: 13 }}>Ders ekle</Text>
          </Pressable>
        )}
      </View>
      {adding && (
        <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
          <TextInput
            autoFocus
            value={name}
            onChangeText={setName}
            placeholder="Ders adı (ör. Mesleki Çözümleme I)"
            placeholderTextColor={colors.faint}
            style={[form.input, { flex: 1 }]}
            onSubmitEditing={add}
          />
          <Btn title={busy ? "…" : "Ekle"} variant="primary" onPress={add} disabled={busy || !name.trim()} />
          <Btn title="Vazgeç" variant="ghost" onPress={() => setAdding(false)} />
        </View>
      )}
      {cls.courses.length === 0 && !adding && (
        <Muted style={{ fontSize: 12.5, marginTop: 6 }}>Bu sınıfta verdiğin dersleri ekle; ödev verirken dersi seçersin.</Muted>
      )}
    </View>
  );
}
