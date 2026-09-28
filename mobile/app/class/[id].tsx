import { useCallback, useState } from "react";
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
      { text: "Sınıfı sil", style: "destructive", onPress: deleteClass },
    ]);
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
            onPress={() => router.push({ pathname: "/assignment/new", params: { classId: id } })}
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
            <Text style={{ color: colors.ink, fontFamily: fonts.ui, fontSize: 13.5 }}>+ Yeni ödev</Text>
          </Pressable>
          {assignments.length === 0 ? (
            <Card>
              <Muted>Bu sınıfta ödev yok.</Muted>
            </Card>
          ) : (
            assignments.map((a) => {
              const past = isPast(dueOf(a));
              const st = stats[a.id];
              const pct = st && st.enrolled ? (st.submitted / st.enrolled) * 100 : 0;
              return (
                <Pressable key={a.id} onPress={() => router.push({ pathname: "/assignment/[id]", params: { id: a.id } })}>
                  <Card>
                    <Text style={{ color: colors.ink, fontSize: 16, fontWeight: "700" }}>{a.title}</Text>
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

      {tab === "notlar" && <GradesTab classId={id} />}
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
function GradesTab({ classId }: { classId: string }) {
  const [g, setG] = useState<ClassGrades | null>(null);
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
