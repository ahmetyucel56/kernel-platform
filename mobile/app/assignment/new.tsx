import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api, ApiError, type ClassOut } from "../../src/api";
import { BackHeader, Btn, Card, Loader, Muted, Screen, Select, form } from "../../src/ui";
import { colors, fonts, radius } from "../../src/theme";
import { PrecheckSettings } from "../../src/PrecheckSettings";
import { DateTimeField } from "../../src/DateTimeField";
import { StudentVisibility, SubmissionKindPicker, type SubmissionKind, type Visibility } from "../../src/StudentVisibility";
import { CoursePicker } from "../../src/CoursePicker";

const PRESETS = [
  { days: 7, label: "1 hafta" },
  { days: 14, label: "2 hafta" },
  { days: 30, label: "1 ay" },
];

function daysFromNow(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(23, 59, 0, 0);
  return d;
}

export default function NewAssignment() {
  const router = useRouter();
  const params = useLocalSearchParams<{ classId?: string; courseId?: string }>();

  const [classes, setClasses] = useState<ClassOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [classId, setClassId] = useState<string>("");
  const [courseId, setCourseId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [reqText, setReqText] = useState("");
  const [deadline, setDeadline] = useState(() => daysFromNow(7));
  const [pre, setPre] = useState({ enabled: false, limit: 3 });
  const [vis, setVis] = useState<Visibility>({ requirement: true, cleanCode: true });
  const [kind, setKind] = useState<SubmissionKind>("code");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Serbest metinden AI ile gereksinim çıkarma
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

  useEffect(() => {
    api<ClassOut[]>("/classes")
      .then((list) => {
        setClasses(list);
        const initial = params.classId && list.some((c) => c.id === params.classId)
          ? params.classId
          : list[0]?.id ?? "";
        setClassId(initial);
        const cls = list.find((c) => c.id === initial);
        const courses = cls?.courses ?? [];
        setCourseId(
          params.courseId && courses.some((c) => c.id === params.courseId)
            ? params.courseId
            : courses.length === 1
              ? courses[0].id
              : ""
        );
      })
      .catch(() => setErr("Sınıflar yüklenemedi."))
      .finally(() => setLoading(false));
  }, []);

  const classLabel = useMemo(
    () => classes.find((c) => c.id === classId)?.name ?? "",
    [classes, classId]
  );
  const classCourses = classes.find((c) => c.id === classId)?.courses ?? [];

  async function save() {
    setErr(null);
    if (!classId) {
      setErr("Önce bir sınıf seç.");
      return;
    }
    if (!courseId) {
      setErr("Ödevin hangi derse ait olduğunu seç.");
      return;
    }
    if (!title.trim()) {
      setErr("Başlık gerekli.");
      return;
    }
    if (deadline.getTime() <= Date.now()) {
      setErr("Teslim tarihi gelecekte olmalı.");
      return;
    }
    const requirements = reqText
      .split("\n")
      .map((r) => r.trim())
      .filter(Boolean);
    setSaving(true);
    try {
      await api("/assignments", {
        method: "POST",
        body: {
          class_id: classId,
          title: title.trim(),
          description: description.trim() || null,
          requirements,
          deadline_at: deadline.toISOString(),
          precheck_enabled: pre.enabled,
          precheck_limit: pre.limit,
          show_requirement_to_student: vis.requirement,
          show_clean_code_to_student: vis.cleanCode,
          submission_kind: kind,
          course_id: courseId,
        },
      });
      router.back();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Ödev oluşturulamadı.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Loader />;

  return (
    <Screen>
      <BackHeader />

      <Text style={{ color: colors.ink, fontSize: 26, fontFamily: fonts.display, marginBottom: 16 }}>
        Ödev ver
      </Text>

      {classes.length === 0 ? (
        <Card>
          <Muted>
            Önce bir sınıfın olmalı. Panom sekmesindeki "Sınıf" düğmesiyle oluşturabilirsin.
          </Muted>
        </Card>
      ) : (
        <Card>
          <Select
            label="Sınıf"
            value={classLabel}
            options={classes.map((c) => c.name)}
            onChange={(name) => {
              const c = classes.find((x) => x.name === name);
              if (c) {
                setClassId(c.id);
                setCourseId(c.courses.length === 1 ? c.courses[0].id : "");
              }
            }}
          />
          <CoursePicker
            classId={classId}
            courses={classCourses}
            value={courseId}
            onChange={setCourseId}
            onClassChanged={(c) => setClasses((list) => list.map((x) => (x.id === c.id ? c : x)))}
          />

          <Text style={s.label}>Başlık</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Ör: Proje 1 — Not Sistemi"
            placeholderTextColor={colors.faint}
            style={s.input}
          />

          <Text style={[s.label, { marginTop: 14 }]}>Açıklama (opsiyonel)</Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Ödevin kısa açıklaması"
            placeholderTextColor={colors.faint}
            multiline
            style={[s.input, { minHeight: 70, textAlignVertical: "top" }]}
          />

          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
            <Text style={[s.label, { marginBottom: 0 }]}>Gereksinimler (her satıra bir madde)</Text>
            <Pressable onPress={() => setShowAi((v) => !v)}>
              <Text style={{ color: colors.blueSoft, fontSize: 12.5, fontWeight: "600" }}>
                {showAi ? "Kapat" : "AI ile çıkar"}
              </Text>
            </Pressable>
          </View>

          {showAi && (
            <View
              style={{
                backgroundColor: colors.bg3,
                borderColor: colors.line,
                borderWidth: 1,
                borderRadius: radius.sm,
                padding: 12,
                marginTop: 8,
                marginBottom: 8,
              }}
            >
              <Muted style={{ fontSize: 12, marginBottom: 8 }}>
                Ödev metnini olduğu gibi yapıştır; AI temiz, kontrol edilebilir maddelere ayırıp aşağıya ekler.
              </Muted>
              <TextInput
                value={aiText}
                onChangeText={setAiText}
                placeholder={"1. Kullanıcıdan ad soyad alınmalı\n2. 3 sınav notu alınmalı\n..."}
                placeholderTextColor={colors.faint}
                multiline
                style={[s.input, { minHeight: 90, textAlignVertical: "top" }]}
              />
              <View style={{ marginTop: 8 }}>
                <Btn
                  title={aiBusy ? "Ayrılıyor…" : "Maddelere ayır"}
                  variant="primary"
                  onPress={parseWithAi}
                  disabled={aiBusy || !aiText.trim()}
                />
              </View>
            </View>
          )}

          <TextInput
            value={reqText}
            onChangeText={setReqText}
            placeholder={"Fonksiyonlara bölünmeli\nGirdi doğrulaması yapılmalı"}
            placeholderTextColor={colors.faint}
            multiline
            style={[s.input, { minHeight: 90, textAlignVertical: "top", marginTop: 8 }]}
          />

          <DateTimeField label="Teslim tarihi" value={deadline} onChange={setDeadline} presets={PRESETS} />

          <SubmissionKindPicker value={kind} onChange={setKind} />
          <PrecheckSettings
            enabled={pre.enabled}
            limit={pre.limit}
            onChange={(enabled, limit) => setPre({ enabled, limit })}
          />
          <StudentVisibility value={vis} onChange={setVis} document={kind === "document"} />

          {err && <Text style={{ color: colors.danger, fontSize: 13, marginTop: 12 }}>{err}</Text>}

          <View style={{ marginTop: 16 }}>
            <Btn
              title={saving ? "Veriliyor…" : "Ödevi ver"}
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
