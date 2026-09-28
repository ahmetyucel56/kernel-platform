import { useCallback, useState } from "react";
import { Alert, Modal, Pressable, Text, TextInput, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { api, ApiError, type Assignment, type ClassOut, type Reopen, type Roster, type RosterRow } from "../../src/api";
import { BackHeader, Btn, Card, Chip, form, Icon, Loader, Muted, Screen, SectionLabel } from "../../src/ui";
import { colors, fonts } from "../../src/theme";
import { PrecheckSettings } from "../../src/PrecheckSettings";
import { DateTimeField } from "../../src/DateTimeField";
import { dueLabel, dueOf, fmtDateTime, isPast, timeLeft } from "../../src/format";
import { StudentVisibility, SubmissionKindPicker, type SubmissionKind, type Visibility } from "../../src/StudentVisibility";
import { CoursePicker } from "../../src/CoursePicker";
import { radius } from "../../src/theme";

function inThreeDays(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  d.setHours(23, 59, 0, 0);
  return d;
}

type Panel = "none" | "reopen" | "edit";

function statusChip(r: RosterRow, warn: number) {
  if (r.similarity != null && r.similarity >= warn) return <Chip text={`Benzerlik %${r.similarity}`} kind="danger" />;
  switch (r.status) {
    case "none":
      return <Chip text="Teslim yok" />;
    case "ungraded":
      return <Chip text="Notlanmadı" kind="blue" />;
    case "new_version":
      return <Chip text={`Yeni sürüm (not v${r.graded_version})`} kind="gold" />;
    default:
      return <Chip text={`Notlandı · ${r.score}`} kind="ok" />;
  }
}

export default function AssignmentDetail() {
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [roster, setRoster] = useState<Roster | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>("none");
  const [showReqs, setShowReqs] = useState(false);
  const toggle = (p: Panel) => setPanel((cur) => (cur === p ? "none" : p));

  // Süre uzatma
  const [reopenBusy, setReopenBusy] = useState(false);
  const [reopenMsg, setReopenMsg] = useState<string | null>(null);
  const [reopenUntil, setReopenUntil] = useState(inThreeDays);
  const [reopens, setReopens] = useState<Reopen[]>([]);
  // Ogrenciye ozel sure ("Süre ver")
  const [extFor, setExtFor] = useState<RosterRow | null>(null);
  const [extUntil, setExtUntil] = useState(inThreeDays);
  const [extBusy, setExtBusy] = useState(false);
  const [extErr, setExtErr] = useState<string | null>(null);
  // Düzenle
  const [eTitle, setETitle] = useState("");
  const [eDesc, setEDesc] = useState("");
  const [eReq, setEReq] = useState("");
  const [eDeadline, setEDeadline] = useState(() => new Date());
  const [ePre, setEPre] = useState({ enabled: false, limit: 3 });
  const [eVis, setEVis] = useState<Visibility>({ requirement: true, cleanCode: true });
  const [eKind, setEKind] = useState<SubmissionKind>("code");
  const [eCourse, setECourse] = useState("");
  const [classInfo, setClassInfo] = useState<ClassOut | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editMsg, setEditMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [a, r, ro] = await Promise.all([
        api<Assignment>(`/assignments/${id}`),
        api<Roster>(`/assignments/${id}/roster`),
        api<Reopen[]>(`/assignments/${id}/reopens`).catch(() => [] as Reopen[]),
      ]);
      setAssignment(a);
      setRoster(r);
      setReopens(ro);
    } catch {
      setErr("Ödev yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Not verip geri dönünce durumlar güncel olsun
  useFocusEffect(
    useCallback(() => {
      if (id) load();
    }, [id, load])
  );

  async function reopen() {
    setReopenMsg(null);
    if (reopenUntil.getTime() <= Date.now()) {
      setReopenMsg("Yeni son tarih gelecekte olmalı.");
      return;
    }
    setReopenBusy(true);
    const d = reopenUntil;
    try {
      await api(`/assignments/${id}/reopen`, {
        method: "POST",
        body: { student_id: null, reopened_until: d.toISOString() },
      });
      setReopenMsg(
        `Teslim ${d.toLocaleString("tr-TR", { day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" })}'a kadar açıldı.`
      );
      load();
    } catch (e) {
      setReopenMsg(e instanceof ApiError ? e.message : "Açılamadı.");
    } finally {
      setReopenBusy(false);
    }
  }

  const activePersonal = reopens.filter((r) => r.active && r.student_id);
  const openForSomeone = assignment ? !isPast(dueOf(assignment)) || reopens.some((r) => r.active) : false;

  function closeNow() {
    const extra = activePersonal.length ? ` ${activePersonal.length} öğrenciye verilen özel süre de sona erecek.` : "";
    Alert.alert(
      "Teslimi şimdi bitir",
      `Teslim herkes için şimdi kapansın mı?${extra} Öğrencilere bildirim gider; istersen sonra yeniden süre verebilirsin.`,
      [
        { text: "Vazgeç", style: "cancel" },
        {
          text: "Şimdi bitir",
          style: "destructive",
          onPress: async () => {
            try {
              await api(`/assignments/${id}/close`, { method: "POST" });
              setReopenMsg("Teslim kapatıldı.");
              load();
            } catch (e) {
              Alert.alert("Hata", e instanceof ApiError ? e.message : "Kapatılamadı.");
            }
          },
        },
      ]
    );
  }

  function cancelReopen(r: Reopen) {
    const who = r.student_name ? `${r.student_name} için` : "Tüm sınıf için";
    Alert.alert("Uzatmayı iptal et", `${who} verilen uzatma iptal edilsin mi? Öğrenci(ler)e bildirim gider.`, [
      { text: "Vazgeç", style: "cancel" },
      {
        text: "İptal et",
        style: "destructive",
        onPress: async () => {
          try {
            await api(`/assignments/${id}/reopens/${r.id}`, { method: "DELETE" });
            load();
          } catch (e) {
            Alert.alert("Hata", e instanceof ApiError ? e.message : "İptal edilemedi.");
          }
        },
      },
    ]);
  }

  async function givePersonal() {
    if (!extFor) return;
    setExtErr(null);
    if (extUntil.getTime() <= Date.now()) {
      setExtErr("Tarih gelecekte olmalı.");
      return;
    }
    setExtBusy(true);
    try {
      await api(`/assignments/${id}/reopen`, {
        method: "POST",
        body: { student_id: extFor.student.id, reopened_until: extUntil.toISOString() },
      });
      setExtFor(null);
      load();
    } catch (e) {
      setExtErr(e instanceof ApiError ? e.message : "Süre verilemedi.");
    } finally {
      setExtBusy(false);
    }
  }

  function openEdit() {
    if (!assignment) return;
    setETitle(assignment.title);
    setECourse(assignment.course_id ?? "");
    api<ClassOut[]>("/classes")
      .then((list) => setClassInfo(list.find((c) => c.id === assignment.class_id) ?? null))
      .catch(() => {});
    setEDesc(assignment.description ?? "");
    setEReq((assignment.requirements_json ?? []).join("\n"));
    setEDeadline(new Date(assignment.deadline_at));
    setEPre({ enabled: !!assignment.precheck_enabled, limit: assignment.precheck_limit ?? 3 });
    setEVis({
      requirement: assignment.show_requirement_to_student !== false,
      cleanCode: assignment.show_clean_code_to_student !== false,
    });
    setEKind(assignment.submission_kind ?? "code");
    setEditMsg(null);
    toggle("edit");
  }

  function saveEdit() {
    if (!eTitle.trim()) {
      setEditMsg("Başlık gerekli.");
      return;
    }
    const changed = assignment && eDeadline.getTime() !== new Date(assignment.deadline_at).getTime();
    if (changed && eDeadline.getTime() <= Date.now()) {
      Alert.alert("Geçmiş tarih", "Seçtiğin tarih geçmişte. Kaydedersen teslimler hemen kapanır. Emin misin?", [
        { text: "Vazgeç", style: "cancel" },
        { text: "Kaydet", style: "destructive", onPress: doSaveEdit },
      ]);
      return;
    }
    doSaveEdit();
  }

  async function doSaveEdit() {
    setSavingEdit(true);
    setEditMsg(null);
    try {
      const updated = await api<Assignment>(`/assignments/${id}`, {
        method: "PATCH",
        body: {
          title: eTitle.trim(),
          description: eDesc.trim() || null,
          requirements: eReq.split("\n").map((r) => r.trim()).filter(Boolean),
          deadline_at: eDeadline.toISOString(),
          precheck_enabled: ePre.enabled,
          precheck_limit: ePre.limit,
          show_requirement_to_student: eVis.requirement,
          show_clean_code_to_student: eVis.cleanCode,
          submission_kind: eKind,
          ...(eCourse ? { course_id: eCourse } : {}),
        },
      });
      setAssignment(updated);
      setPanel("none");
      load(); // tarih degistiyse sinif uzatmasi kalkmis olabilir
    } catch (e) {
      setEditMsg(e instanceof ApiError ? e.message : "Güncellenemedi.");
    } finally {
      setSavingEdit(false);
    }
  }

  function removeAssignment() {
    Alert.alert("Ödevi sil", `"${assignment?.title ?? "Ödev"}" ve tüm gönderimleri kalıcı olarak silinecek. Emin misin?`, [
      { text: "Vazgeç", style: "cancel" },
      {
        text: "Sil",
        style: "destructive",
        onPress: async () => {
          try {
            await api(`/assignments/${id}`, { method: "DELETE" });
            router.back();
          } catch (e) {
            Alert.alert("Hata", e instanceof ApiError ? e.message : "Silinemedi.");
          }
        },
      },
    ]);
  }

  if (loading) return <Loader />;

  const reqs = assignment?.requirements_json ?? [];
  const past = assignment ? isPast(dueOf(assignment)) : false;

  return (
    <Screen>
      <BackHeader />
      {err && <Text style={{ color: colors.danger, marginBottom: 10 }}>{err}</Text>}

      {assignment?.course_name ? (
        <View style={{ flexDirection: "row", marginBottom: 6 }}>
          <Chip text={assignment.course_name} kind="gold" />
        </View>
      ) : null}
      <Text style={{ color: colors.ink, fontSize: 23, fontFamily: fonts.display }}>{assignment?.title ?? "Ödev"}</Text>
      {assignment && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <Chip text={past ? "Süre doldu" : "Açık"} kind={past ? "muted" : "gold"} />
          <Muted style={{ fontSize: 13, flexShrink: 1 }}>
            {dueLabel(assignment)}
            {assignment.precheck_enabled ? ` · Ön kontrol ${assignment.precheck_limit}/gün` : ""}
          </Muted>
        </View>
      )}
      {assignment && (
        <Muted style={{ fontSize: 12, marginTop: 4 }}>
          {assignment.submission_kind === "document" ? "Rapor / belge · " : ""}
          Öğrenci AI sonuçlarını görüyor: gereksinim {assignment.show_requirement_to_student === false ? "✗" : "✓"}
          {assignment.submission_kind === "document"
            ? ""
            : ` · Clean Code ${assignment.show_clean_code_to_student === false ? "✗" : "✓"}`}
        </Muted>
      )}
      {assignment?.description ? <Muted style={{ marginTop: 8, fontSize: 13.5 }}>{assignment.description}</Muted> : null}
      {reqs.length > 0 && (
        <Pressable onPress={() => setShowReqs((v) => !v)} style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8 }}>
          <Icon name={showReqs ? "chevron-down" : "chevron-right"} size={15} color={colors.muted} />
          <Muted style={{ fontSize: 13 }}>Kurallar ({reqs.length})</Muted>
        </Pressable>
      )}
      {showReqs &&
        reqs.map((r, i) => (
          <Text key={i} style={{ color: colors.muted, fontSize: 13, marginLeft: 19, marginTop: 2 }}>
            • {r}
          </Text>
        ))}

      {/* Eylemler (web'deki düğme sırası) */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
        <Btn small title="Teslim süresi" variant={panel === "reopen" ? "gold" : "ghost"} onPress={() => toggle("reopen")} />
        <Btn small title="Düzenle" variant={panel === "edit" ? "gold" : "ghost"} onPress={openEdit} />
        <Btn small title="Sil" variant="danger" onPress={removeAssignment} />
      </View>

      {panel === "edit" && (
        <Card style={{ marginTop: 12 }}>
          {classInfo && (
            <CoursePicker
              classId={classInfo.id}
              courses={classInfo.courses}
              value={eCourse}
              onChange={setECourse}
              onClassChanged={setClassInfo}
            />
          )}
          <Text style={form.label}>Başlık</Text>
          <TextInput value={eTitle} onChangeText={setETitle} placeholderTextColor={colors.faint} style={form.input} />
          <Text style={[form.label, { marginTop: 10 }]}>Açıklama</Text>
          <TextInput
            value={eDesc}
            onChangeText={setEDesc}
            multiline
            placeholderTextColor={colors.faint}
            style={[form.input, { minHeight: 60, textAlignVertical: "top" }]}
          />
          <Text style={[form.label, { marginTop: 10 }]}>Gereksinimler (her satıra bir madde)</Text>
          <TextInput
            value={eReq}
            onChangeText={setEReq}
            multiline
            placeholderTextColor={colors.faint}
            style={[form.input, { minHeight: 80, textAlignVertical: "top" }]}
          />
          <DateTimeField label="Teslim tarihi" value={eDeadline} onChange={setEDeadline} />
          {assignment && eDeadline.getTime() !== new Date(assignment.deadline_at).getTime() && (
            <Muted style={{ fontSize: 12, marginTop: 6 }}>
              Yeni tarih, tüm sınıfa verilmiş uzatmanın yerine geçer. Öğrenciye özel uzatmalar kalır ("Teslim süresi"nden
              iptal edebilirsin).
            </Muted>
          )}
          <SubmissionKindPicker value={eKind} onChange={setEKind} />
          <PrecheckSettings enabled={ePre.enabled} limit={ePre.limit} onChange={(enabled, limit) => setEPre({ enabled, limit })} />
          <StudentVisibility value={eVis} onChange={setEVis} document={eKind === "document"} />
          {editMsg && <Text style={{ color: colors.danger, fontSize: 13, marginTop: 8 }}>{editMsg}</Text>}
          <View style={{ marginTop: 12 }}>
            <Btn title={savingEdit ? "Kaydediliyor…" : "Kaydet"} variant="gold" onPress={saveEdit} disabled={savingEdit} />
          </View>
        </Card>
      )}

      {panel === "reopen" && (
        <Card style={{ marginTop: 12 }}>
          <Text style={form.label}>Durum</Text>
          <Text style={{ color: colors.ink, fontSize: 14.5, fontWeight: "600" }}>
            {!assignment || !openForSomeone
              ? "Kapalı"
              : isPast(dueOf(assignment))
                ? `Sınıfa kapalı · ${activePersonal.length} öğrencinin özel süresi var`
                : `Açık · ${timeLeft(dueOf(assignment))} kaldı`}
          </Text>
          {openForSomeone && (
            <View style={{ marginTop: 10 }}>
              <Btn title="Teslimi şimdi bitir" icon="lock" variant="danger" onPress={closeNow} />
            </View>
          )}
          <DateTimeField
            label="Tüm sınıf için yeni son tarih"
            value={reopenUntil}
            onChange={setReopenUntil}
            presets={[
              { days: 3, label: "+3 gün" },
              { days: 7, label: "+7 gün" },
            ]}
          />
          <View style={{ marginTop: 12 }}>
            <Btn title={reopenBusy ? "…" : "Tüm sınıfa uzat"} variant="primary" onPress={reopen} disabled={reopenBusy} />
          </View>
          {reopenMsg && (
            <Text style={{ color: reopenMsg.includes("açıldı") || reopenMsg.includes("kapatıldı") ? colors.ok : colors.danger, fontSize: 13, marginTop: 10 }}>
              {reopenMsg}
            </Text>
          )}
          <Muted style={{ fontSize: 12, marginTop: 8 }}>Tek öğrenciye süre için aşağıdaki listede "Süre ver".</Muted>
          <Text style={[form.label, { marginTop: 16 }]}>Verilmiş uzatmalar</Text>
          {reopens.length === 0 ? (
            <Muted style={{ fontSize: 13 }}>Uzatma yok.</Muted>
          ) : (
            reopens.map((r) => (
              <View
                key={r.id}
                style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, opacity: r.active ? 1 : 0.55 }}
              >
                <Text style={{ color: colors.ink, fontSize: 13.5, flex: 1 }}>
                  <Text style={{ fontWeight: "700" }}>{r.student_name ?? "Tüm sınıf"}</Text> · {fmtDateTime(r.reopened_until)}
                  {r.active ? "" : " (süresi geçti)"}
                </Text>
                <Pressable onPress={() => cancelReopen(r)} hitSlop={6} style={{ padding: 6 }}>
                  <Text style={{ color: colors.danger, fontSize: 13 }}>İptal et</Text>
                </Pressable>
              </View>
            ))
          )}
        </Card>
      )}

      {/* Teslimler: bakılması gerekenler üstte (benzerlik, notlanmamış, yeni sürüm) */}
      <SectionLabel
        right={
          roster ? (
            <Muted style={{ fontSize: 12 }}>
              {roster.submitted}/{roster.enrolled} teslim · {roster.graded} notlandı
            </Muted>
          ) : undefined
        }
      >
        Teslimler
      </SectionLabel>
      {!roster || roster.rows.length === 0 ? (
        <Card>
          <Muted>Bu sınıfta kayıtlı öğrenci yok.</Muted>
        </Card>
      ) : (
        <Card style={{ paddingVertical: 2 }}>
          {roster.rows.map((r, i) => (
            <Pressable
              key={r.student.id}
              disabled={!r.latest}
              onPress={() => r.latest && router.push({ pathname: "/submission/[id]", params: { id: r.latest.id } })}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                paddingVertical: 11,
                borderTopWidth: i ? 1 : 0,
                borderTopColor: colors.line,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: r.latest ? colors.ink : colors.muted, fontSize: 14.5, fontWeight: "600" }}>
                  {r.student.full_name}
                </Text>
                <Muted style={{ fontSize: 12 }}>
                  {r.student.school_no ?? ""}
                  {r.latest ? ` · v${r.latest.version_number}${r.versions > 1 ? ` (${r.versions} sürüm)` : ""}` : ""}
                </Muted>
                {r.extended_until ? (
                  <Text style={{ color: colors.gold, fontSize: 11.5, marginTop: 2 }}>Özel süre: {fmtDateTime(r.extended_until)}</Text>
                ) : null}
                <Pressable
                  onPress={() => {
                    setExtErr(null);
                    setExtUntil(inThreeDays());
                    setExtFor(r);
                  }}
                  hitSlop={6}
                  style={{ alignSelf: "flex-start", marginTop: 4 }}
                >
                  <Text style={{ color: colors.blueSoft, fontSize: 12.5, fontWeight: "600" }}>Süre ver</Text>
                </Pressable>
              </View>
              {statusChip(r, roster.similarity_warn)}
              {r.latest ? <Icon name="chevron-right" size={16} color={colors.muted} /> : <View style={{ width: 16 }} />}
            </Pressable>
          ))}
        </Card>
      )}

      {/* Ogrenciye ozel sure */}
      <Modal visible={!!extFor} transparent animationType="fade" onRequestClose={() => setExtFor(null)}>
        <Pressable style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: "center", padding: 18 }} onPress={() => setExtFor(null)}>
          <Pressable
            onPress={() => {}}
            style={{ backgroundColor: colors.bg2, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: 16 }}
          >
            <Text style={{ color: colors.ink, fontSize: 17, fontFamily: fonts.displayBold }}>{extFor?.student.full_name}</Text>
            <Muted style={{ fontSize: 13, marginTop: 2 }}>Yalnızca bu öğrenci için son tarih; öğrenciye bildirim gider.</Muted>
            <DateTimeField
              label="Son tarih"
              value={extUntil}
              onChange={setExtUntil}
              presets={[
                { days: 1, label: "+1 gün" },
                { days: 3, label: "+3 gün" },
                { days: 7, label: "+7 gün" },
              ]}
            />
            {extErr && <Text style={{ color: colors.danger, fontSize: 13, marginTop: 8 }}>{extErr}</Text>}
            <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
              <View style={{ flex: 1 }}>
                <Btn title="Vazgeç" variant="ghost" onPress={() => setExtFor(null)} />
              </View>
              <View style={{ flex: 1 }}>
                <Btn title={extBusy ? "…" : "Süre ver"} variant="gold" onPress={givePersonal} disabled={extBusy} />
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}
