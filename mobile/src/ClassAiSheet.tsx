import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  api,
  ApiError,
  type ClassOverview,
  type OverviewStudent,
  type OverviewStudentStatus,
  type ReqStatus,
} from "./api";
import { Btn, Sparkle } from "./ui";
import { CodeQualityPanel } from "./CodeQualityPanel";
import { colors, radius } from "./theme";

const STATUS_LABEL: Record<OverviewStudentStatus, string> = {
  at_risk: "Riskli",
  late: "Teslim yok · süre doldu",
  pending: "Analiz bekliyor",
  no_submission: "Teslim yok",
  ok: "İyi",
};
const STATUS_COLOR: Record<OverviewStudentStatus, string> = {
  at_risk: colors.danger,
  late: colors.danger,
  pending: colors.gold,
  no_submission: colors.faint,
  ok: colors.ok,
};
const statusLabel = (s: OverviewStudent) => (s.stale ? "Kurallar değişti" : STATUS_LABEL[s.status]);
const REQ_LABEL: Record<ReqStatus, string> = { met: "Tam", partial: "Kısmen", missing: "Eksik" };
const REQ_COLOR: Record<ReqStatus, string> = { met: colors.ok, partial: colors.gold, missing: colors.danger };

function covColor(c: number | null) {
  if (c == null) return colors.muted;
  return c >= 75 ? colors.ok : c >= 50 ? colors.gold : colors.danger;
}

/**
 * Sınıf AI özeti pop-it'i (web'deki ClassAiModal ile aynı). Sınıf satırındaki AI
 * butonu (sınıf özeti) veya öğrenci satırındaki AI butonu (studentId ile) açar.
 */
export function ClassAiSheet({
  visible,
  classId,
  className,
  studentId: initialStudentId,
  onClose,
}: {
  visible: boolean;
  classId: string;
  className: string;
  studentId?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [data, setData] = useState<ClassOverview | null>(null);
  const [assignmentId, setAssignmentId] = useState<string | null>(null);
  const [tab, setTab] = useState<"class" | "student" | "code">("class");
  const [studentId, setStudentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Her açılışta başlangıç sekmesini ayarla
  useEffect(() => {
    if (!visible) return;
    setTab(initialStudentId ? "student" : "class");
    setStudentId(initialStudentId ?? null);
    setInfo(null);
  }, [visible, initialStudentId]);

  useEffect(() => {
    if (!visible || !classId) return;
    setLoading(true);
    setErr(null);
    const q = assignmentId ? `?assignment_id=${assignmentId}` : "";
    api<ClassOverview>(`/classes/${classId}/ai-overview${q}`)
      .then(setData)
      .catch((e) => setErr(e instanceof ApiError ? e.message : "Özet yüklenemedi."))
      .finally(() => setLoading(false));
  }, [visible, classId, assignmentId]);

  async function analyzePending() {
    if (!data?.assignment || analyzing) return;
    setAnalyzing(true);
    setErr(null);
    setInfo(null);
    try {
      const res = await api<ClassOverview>(`/classes/${classId}/ai-overview/analyze`, {
        method: "POST",
        body: { assignment_id: data.assignment.id },
      });
      setData(res);
      if (res.newly_analyzed) setInfo(`${res.newly_analyzed} teslim analiz edildi.`);
      else if (!res.failed) setInfo("Analiz bekleyen teslim yoktu.");
      if (res.failed)
        setErr(`${res.failed} teslim için yapay zekâ yanıt veremedi; sonuç kaydedilmedi. Biraz sonra tekrar dene.`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Analiz yapılamadı.");
    } finally {
      setAnalyzing(false);
    }
  }

  /** Eksik/kısmen kuralları öğrenci(ler)e yorum + bildirim olarak iletir.
   *  submissionId yoksa: eksiği olan ve henüz bildirilmemiş herkese. */
  async function sendFeedback(submissionId?: string) {
    if (!data?.assignment || sending) return;
    setSending(true);
    setErr(null);
    setInfo(null);
    try {
      const res = await api<ClassOverview>(`/classes/${classId}/ai-overview/send-feedback`, {
        method: "POST",
        body: { assignment_id: data.assignment.id, submission_ids: submissionId ? [submissionId] : null },
      });
      setData(res);
      setInfo(res.feedback_sent ? `Eksikler ${res.feedback_sent} öğrenciye iletildi.` : "İletilecek yeni eksik yoktu.");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Gönderilemedi.");
    } finally {
      setSending(false);
    }
  }

  function openSubmission(id: string) {
    onClose();
    router.push({ pathname: "/submission/[id]", params: { id } });
  }

  const student = data?.students.find((s) => s.student_id === studentId) ?? null;
  const hasReqs = (data?.assignment?.requirements.length ?? 0) > 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 14 }}
        onPress={onClose}
      >
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: colors.bg2,
            borderColor: colors.line2,
            borderWidth: 1,
            borderRadius: radius.lg,
            maxHeight: "88%",
            overflow: "hidden",
          }}
        >
          {/* Başlık */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              padding: 14,
              borderBottomWidth: 1,
              borderBottomColor: colors.line,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
              <View
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  backgroundColor: colors.goldBg,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Sparkle size={17} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.ink, fontSize: 15, fontWeight: "800" }} numberOfLines={1}>
                  {className}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>AI Özeti</Text>
              </View>
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={{ padding: 6 }}>
              <Text style={{ color: colors.muted, fontSize: 18 }}>✕</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 18 }}>
            {/* Ödev seçimi */}
            {data && data.assignments.length > 1 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                <View style={{ flexDirection: "row", gap: 6 }}>
                  {data.assignments.map((a) => {
                    const on = a.id === data.assignment?.id;
                    return (
                      <Pressable
                        key={a.id}
                        onPress={() => {
                          setAssignmentId(a.id);
                          setInfo(null);
                        }}
                        style={{
                          paddingVertical: 6,
                          paddingHorizontal: 12,
                          borderRadius: 999,
                          borderWidth: 1,
                          borderColor: on ? colors.gold : colors.line2,
                          backgroundColor: on ? colors.goldBg : "transparent",
                        }}
                      >
                        <Text style={{ color: on ? colors.gold : colors.muted, fontSize: 12.5, fontWeight: "600" }}>
                          {a.title}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>
            )}

            {/* Sekmeler */}
            <View style={{ flexDirection: "row", gap: 6, marginBottom: 14 }}>
              {(["class", "student", "code"] as const).map((t) => {
                const on = tab === t;
                return (
                  <Pressable
                    key={t}
                    onPress={() => setTab(t)}
                    style={{
                      flex: 1,
                      alignItems: "center",
                      paddingVertical: 9,
                      borderRadius: radius.sm,
                      borderWidth: 1,
                      borderColor: on ? colors.gold : colors.line2,
                      backgroundColor: on ? colors.gold : "transparent",
                    }}
                  >
                    <Text style={{ color: on ? colors.onGold : colors.muted, fontSize: 13, fontWeight: on ? "800" : "500" }}>
                      {t === "class" ? "Sınıf" : t === "student" ? "Öğrenci" : "Kod kalitesi"}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {loading && !data && <ActivityIndicator color={colors.gold} style={{ marginVertical: 20 }} />}
            {err && <Text style={{ color: colors.danger, fontSize: 13, marginBottom: 8 }}>{err}</Text>}
            {info && <Text style={{ color: colors.ok, fontSize: 13, marginBottom: 8 }}>{info}</Text>}

            {data && !data.assignment && (
              <Text style={{ color: colors.muted }}>Bu sınıfta henüz ödev yok. Ödev verince özet burada görünür.</Text>
            )}

            {data?.assignment && tab === "code" && <CodeQualityPanel assignmentId={data.assignment.id} />}

            {data?.assignment && !hasReqs && tab !== "code" && (
              <View style={{ backgroundColor: colors.bg3, borderRadius: radius.sm, padding: 12, marginBottom: 12 }}>
                <Text style={{ color: colors.ink, fontSize: 13 }}>
                  Bu ödevde gereksinim tanımlı değil. Kural bazlı kontrol için ödeve gereksinim ekle.
                </Text>
              </View>
            )}

            {data?.assignment && tab === "class" && (
              <ClassTab
                data={data}
                hasReqs={hasReqs}
                analyzing={analyzing}
                onAnalyze={analyzePending}
                sending={sending}
                onSendAll={() => sendFeedback()}
                onShowStudents={() => setTab("student")}
              />
            )}

            {data?.assignment && tab === "student" &&
              (student ? (
                <StudentDetail
                  s={student}
                  hasReqs={hasReqs}
                  analyzing={analyzing}
                  onAnalyze={analyzePending}
                  sending={sending}
                  onSend={() => sendFeedback(student.submission_id!)}
                  onBack={() => setStudentId(null)}
                  onOpen={openSubmission}
                />
              ) : (
                <StudentList students={data.students} onPick={setStudentId} />
              ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Metric({ k, v, color = colors.ink }: { k: string; v: string; color?: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg3, borderRadius: 12, padding: 10 }}>
      <Text style={{ color: colors.muted, fontSize: 11 }}>{k}</Text>
      <Text style={{ color, fontSize: 21, fontWeight: "800", marginTop: 2 }}>{v}</Text>
    </View>
  );
}

function Label({ children }: { children: string }) {
  return (
    <Text
      style={{
        color: colors.muted,
        fontSize: 11,
        fontWeight: "700",
        letterSpacing: 1,
        textTransform: "uppercase",
        marginTop: 4,
        marginBottom: 8,
      }}
    >
      {children}
    </Text>
  );
}

function ClassTab({
  data,
  hasReqs,
  analyzing,
  onAnalyze,
  sending,
  onSendAll,
  onShowStudents,
}: {
  data: ClassOverview;
  hasReqs: boolean;
  analyzing: boolean;
  onAnalyze: () => void;
  sending: boolean;
  onSendAll: () => void;
  onShowStudents: () => void;
}) {
  const flagged = data.requirements.filter((r) => r.missing + r.partial > 0);
  const shown = flagged.length ? flagged : data.requirements;
  return (
    <>
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 14 }}>
        <Metric
          k="Ort. kapsam"
          v={data.average_coverage == null ? "—" : `%${data.average_coverage}`}
          color={covColor(data.average_coverage)}
        />
        <Metric k="Teslim" v={`${data.submitted_count}/${data.enrolled_count}`} />
        <Metric k="Riskli" v={String(data.at_risk_count)} color={data.at_risk_count ? colors.danger : colors.ink} />
      </View>

      <Text style={{ color: colors.ink, fontSize: 14, lineHeight: 20 }}>{data.headline}</Text>
      {data.insights.map((t, i) => (
        <Text key={i} style={{ color: colors.ink, fontSize: 13.5, lineHeight: 20, marginTop: 4 }}>
          •  {t}
        </Text>
      ))}

      {data.recurring_topics.length > 0 && (
        <View style={{ marginTop: 14 }}>
          <Label>Ödevler boyunca tekrar eden zayıflıklar</Label>
          {data.recurring_topics.map((t) => (
            <View key={t.topic} style={{ backgroundColor: colors.bg3, borderRadius: 10, padding: 10, marginBottom: 7 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger }} />
                <Text style={{ color: colors.ink, fontSize: 13.5, flex: 1 }}>{t.topic}</Text>
              </View>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4, marginLeft: 16 }}>
                {t.students.length} öğrenci: {t.students.slice(0, 3).join(", ")}
                {t.students.length > 3 ? ` +${t.students.length - 3}` : ""}
              </Text>
            </View>
          ))}
        </View>
      )}

      {hasReqs && data.analyzed_count > 0 && (
        <View style={{ marginTop: 14 }}>
          <Label>{flagged.length ? "En çok eksik kalan kurallar" : "Kurallar"}</Label>
          {shown.map((r) => (
            <View
              key={r.requirement}
              style={{ backgroundColor: colors.bg3, borderRadius: 10, padding: 10, marginBottom: 7 }}
            >
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    marginTop: 6,
                    backgroundColor: r.missing ? colors.danger : r.partial ? colors.gold : colors.ok,
                  }}
                />
                <Text style={{ color: colors.ink, fontSize: 13.5, flex: 1 }}>{r.requirement}</Text>
              </View>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4, marginLeft: 16 }}>
                {r.met} tam · {r.partial} kısmen · {r.missing} eksik
              </Text>
            </View>
          ))}
        </View>
      )}

      <View style={{ gap: 8, marginTop: 14 }}>
        {hasReqs && data.pending_count > 0 && (
          <Btn
            title={
              analyzing
                ? "AI analiz ediyor…"
                : data.stale_count > 0
                  ? `Yeniden analiz et (${data.pending_count})`
                  : `Bekleyenleri analiz et (${data.pending_count})`
            }
            variant="gold"
            onPress={onAnalyze}
            disabled={analyzing}
          />
        )}
        {data.feedback_pending_count > 0 && (
          <Btn
            title={sending ? "Gönderiliyor…" : `Eksikleri öğrencilere gönder (${data.feedback_pending_count})`}
            variant="primary"
            onPress={onSendAll}
            disabled={sending}
          />
        )}
        <Btn title="Öğrenci bazında gör" variant="ghost" onPress={onShowStudents} />
      </View>
      {analyzing && (
        <Text style={{ color: colors.faint, fontSize: 12, marginTop: 8 }}>
          Her teslimdeki kurallar tek tek kontrol ediliyor; öğrenci sayısına göre biraz sürebilir.
        </Text>
      )}
    </>
  );
}

function StudentList({ students, onPick }: { students: OverviewStudent[]; onPick: (id: string) => void }) {
  if (students.length === 0) return <Text style={{ color: colors.muted }}>Bu sınıfta kayıtlı öğrenci yok.</Text>;
  return (
    <>
      {students.map((s) => (
        <Pressable
          key={s.student_id}
          onPress={() => onPick(s.student_id)}
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            backgroundColor: colors.bg3,
            borderRadius: 10,
            paddingVertical: 11,
            paddingHorizontal: 12,
            marginBottom: 7,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: STATUS_COLOR[s.status] }} />
            <Text style={{ color: colors.ink, fontSize: 14 }} numberOfLines={1}>
              {s.full_name}
            </Text>
          </View>
          <Text style={{ color: STATUS_COLOR[s.status], fontSize: 12.5 }}>
            {s.trend === "up" ? <Text style={{ color: colors.ok }}>▲ </Text> : null}
            {s.trend === "down" ? <Text style={{ color: colors.danger }}>▼ </Text> : null}
            {s.coverage != null ? `%${s.coverage} kapsam` : statusLabel(s)}
            {s.feedback_sent_at ? " · iletildi" : ""} ›
          </Text>
        </Pressable>
      ))}
    </>
  );
}

function StudentDetail({
  s,
  hasReqs,
  analyzing,
  onAnalyze,
  sending,
  onSend,
  onBack,
  onOpen,
}: {
  s: OverviewStudent;
  hasReqs: boolean;
  analyzing: boolean;
  onAnalyze: () => void;
  sending: boolean;
  onSend: () => void;
  onBack: () => void;
  onOpen: (submissionId: string) => void;
}) {
  const hasGaps = s.analyzed && s.missing + s.partial > 0;
  const sentWhen = s.feedback_sent_at
    ? new Date(s.feedback_sent_at).toLocaleDateString("tr-TR", { day: "2-digit", month: "short" })
    : "";
  const when = s.submitted_at
    ? new Date(s.submitted_at).toLocaleDateString("tr-TR", { day: "2-digit", month: "short" })
    : "";
  return (
    <>
      <Pressable onPress={onBack} style={{ marginBottom: 10 }}>
        <Text style={{ color: colors.blueSoft, fontSize: 13 }}>← Tüm öğrenciler</Text>
      </Pressable>

      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.ink, fontSize: 18, fontWeight: "800" }}>{s.full_name}</Text>
          <Text style={{ color: colors.muted, fontSize: 12.5 }}>
            {s.school_no ? `No: ${s.school_no} · ` : ""}
            {s.submission_id ? `v${s.version} · ${when}` : "Teslim yok"}
            {s.score != null ? ` · Not: ${s.score}` : ""}
            {s.precheck_count > 0 ? ` · ${s.precheck_count} ön kontrol` : ""}
          </Text>
        </View>
        {s.coverage != null && (
          <View style={{ alignItems: "flex-end" }}>
            <Text style={{ color: covColor(s.coverage), fontSize: 26, fontWeight: "800" }}>%{s.coverage}</Text>
            <Text style={{ color: colors.muted, fontSize: 11 }}>
              {s.met} tam · {s.partial} kısmen · {s.missing} eksik
            </Text>
          </View>
        )}
      </View>

      {!s.submission_id && <Text style={{ color: colors.muted }}>Bu öğrenci bu ödevi henüz teslim etmedi.</Text>}

      {s.submission_id && !s.analyzed && (
        <View style={{ backgroundColor: colors.bg3, borderRadius: radius.sm, padding: 12, gap: 10 }}>
          <Text style={{ color: colors.ink, fontSize: 13 }}>
            {s.stale
              ? "Bu teslimin analizi, ödevin kuralları değişmeden önce yapılmış; sonuç artık güncel değil."
              : "Bu teslim henüz AI ile analiz edilmedi."}
          </Text>
          {hasReqs && (
            <Btn
              title={analyzing ? "AI analiz ediyor…" : s.stale ? "Yeniden analiz et" : "Analiz bekleyenleri analiz et"}
              variant="gold"
              onPress={onAnalyze}
              disabled={analyzing}
            />
          )}
        </View>
      )}

      {hasGaps && (
        <View style={{ backgroundColor: colors.bg3, borderRadius: radius.sm, padding: 12, gap: 10, marginBottom: 10 }}>
          <Text style={{ color: s.feedback_sent_at ? colors.ok : colors.ink, fontSize: 13 }}>
            {s.feedback_sent_at
              ? `✓ Eksikler ${sentWhen} tarihinde öğrenciye iletildi.`
              : "Eksikler henüz öğrenciye iletilmedi."}
          </Text>
          <Btn
            title={sending ? "Gönderiliyor…" : s.feedback_sent_at ? "Tekrar gönder" : "Eksikleri öğrenciye gönder"}
            variant={s.feedback_sent_at ? "ghost" : "primary"}
            onPress={onSend}
            disabled={sending}
          />
        </View>
      )}

      {s.analyzed &&
        s.items.map((it, i) => (
          <View key={i} style={{ backgroundColor: colors.bg3, borderRadius: 10, padding: 10, marginBottom: 7 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
              <Text style={{ color: colors.ink, fontSize: 13.5, fontWeight: "700", flex: 1 }}>{it.requirement}</Text>
              <View
                style={{
                  borderWidth: 1,
                  borderColor: REQ_COLOR[it.status],
                  borderRadius: 999,
                  paddingHorizontal: 9,
                  paddingVertical: 2,
                  alignSelf: "flex-start",
                }}
              >
                <Text style={{ color: REQ_COLOR[it.status], fontSize: 11.5, fontWeight: "700" }}>
                  {REQ_LABEL[it.status]}
                </Text>
              </View>
            </View>
            {it.evidence ? (
              <Text style={{ color: colors.muted, fontSize: 12.5, marginTop: 4 }}>{it.evidence}</Text>
            ) : null}
            {it.where ? (
              <Text style={{ color: colors.faint, fontSize: 12, marginTop: 2, fontFamily: "monospace" }}>{it.where}</Text>
            ) : null}
          </View>
        ))}

      {s.submission_id && (
        <View style={{ marginTop: 10 }}>
          <Btn title="Teslimi aç →" variant="ghost" onPress={() => onOpen(s.submission_id!)} />
        </View>
      )}

      <Growth s={s} />
    </>
  );
}

/** Öğrencinin sınıftaki tüm ödevlerde kapsamı + tekrar eden zayıf konular. */
function Growth({ s }: { s: OverviewStudent }) {
  if (s.history.length < 2 && s.recurring.length === 0) return null;
  return (
    <View style={{ marginTop: 16 }}>
      <Label>Gelişim (ödevler boyunca)</Label>
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 6, height: 86 }}>
        {s.history.map((p) => (
          <View key={p.assignment_id} style={{ flex: 1, alignItems: "center", gap: 3 }}>
            <Text style={{ color: colors.faint, fontSize: 10.5 }}>
              {p.coverage != null ? `%${p.coverage}` : p.submitted ? "?" : "—"}
            </Text>
            <View
              style={{
                width: "100%",
                maxWidth: 38,
                height: p.coverage != null ? Math.max(4, (p.coverage / 100) * 58) : 4,
                borderRadius: 4,
                backgroundColor: p.coverage != null ? covColor(p.coverage) : colors.line2,
              }}
            />
          </View>
        ))}
      </View>
      <View style={{ flexDirection: "row", gap: 6, marginTop: 4 }}>
        {s.history.map((p) => (
          <Text key={p.assignment_id} numberOfLines={1} style={{ flex: 1, color: colors.faint, fontSize: 10.5, textAlign: "center" }}>
            {p.title}
          </Text>
        ))}
      </View>
      {s.trend && (
        <Text
          style={{
            fontSize: 13,
            marginTop: 8,
            color: s.trend === "up" ? colors.ok : s.trend === "down" ? colors.danger : colors.muted,
          }}
        >
          {s.trend === "up" ? "▲ Son ödevde yükseliş var." : s.trend === "down" ? "▼ Son ödevde düşüş var." : "Son iki ödevde benzer seviyede."}
        </Text>
      )}
      {s.recurring.map((r) => (
        <View key={r.topic} style={{ backgroundColor: colors.bg3, borderRadius: 10, padding: 10, marginTop: 8 }}>
          <Text style={{ color: colors.ink, fontSize: 13 }}>
            <Text style={{ fontWeight: "800" }}>{r.topic}</Text>
            <Text style={{ color: colors.muted }}>{` — ${r.count}/${r.of} ödevde eksik veya kısmen`}</Text>
          </Text>
          <Text style={{ color: colors.faint, fontSize: 12, marginTop: 2 }}>{r.assignments.join(" · ")}</Text>
        </View>
      ))}
    </View>
  );
}
