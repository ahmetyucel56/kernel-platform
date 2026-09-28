import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { api, ApiError, type AnalysisOut } from "./api";
import { Btn, Chip } from "./ui";
import { colors, fonts, radius } from "./theme";
import { fmtDateTime } from "./format";

/** Sınıfın kod kalitesi (Clean Code) raporu — AI özeti sayfasının "Kod kalitesi"
 *  sekmesi (web'deki ClassSummaryPanel ile aynı). Yalnızca en son rapor gösterilir. */
export function CodeQualityPanel({ assignmentId }: { assignmentId: string }) {
  const [latest, setLatest] = useState<AnalysisOut | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLatest(null);
    setLoaded(false);
    api<AnalysisOut[]>(`/assignments/${assignmentId}/class-analyses`)
      .then((rows) => setLatest(rows[0] ?? null))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [assignmentId]);

  async function run() {
    setErr(null);
    setBusy(true);
    try {
      setLatest(await api<AnalysisOut>(`/assignments/${assignmentId}/analyze-class`, { method: "POST" }));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Rapor oluşturulamadı.");
    } finally {
      setBusy(false);
    }
  }

  const s = (latest?.summary_json ?? {}) as { average?: number; student_count?: number };
  const d = (latest?.detail_json ?? {}) as {
    topics?: string[];
    common_issues?: { title: string; count: number }[];
    per_student?: { student_name: string; score: number }[];
    note?: string;
  };

  return (
    <View>
      <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 19, marginBottom: 12 }}>
        Tüm teslimlerin kodunu birlikte değerlendirir: ortalama Clean Code, en sık hatalar ve tekrar
        anlatılması önerilen konular. Kurallardan bağımsızdır.
      </Text>
      {err && <Text style={{ color: colors.danger, fontSize: 13, marginBottom: 8 }}>{err}</Text>}
      {loaded && !latest && (
        <Text style={{ color: colors.muted, fontSize: 13, marginBottom: 12 }}>Bu ödev için henüz rapor yok.</Text>
      )}
      {latest && (
        <View style={{ backgroundColor: colors.bg3, borderRadius: radius.md, padding: 14, marginBottom: 12, gap: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap" }}>
            <Text style={{ color: colors.ink, fontSize: 28, fontFamily: fonts.display }}>
              {s.average ?? "—"}
              <Text style={{ color: colors.muted, fontSize: 13 }}> /100 · {s.student_count ?? "?"} öğrenci</Text>
            </Text>
            <Text style={{ color: colors.faint, fontSize: 11.5 }}>{fmtDateTime(latest.created_at)}</Text>
          </View>
          {!!d.topics?.length && (
            <View>
              <Text style={{ color: colors.ink, fontSize: 13, fontWeight: "700", marginBottom: 6 }}>
                Tekrar anlatılması önerilen konular
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {d.topics.map((t, i) => (
                  <Chip key={i} text={t} kind="gold" />
                ))}
              </View>
            </View>
          )}
          {!!d.common_issues?.length && (
            <View>
              <Text style={{ color: colors.ink, fontSize: 13, fontWeight: "700", marginBottom: 4 }}>En sık yapılan hatalar</Text>
              {d.common_issues.map((ci, i) => (
                <View key={i} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 3, gap: 8 }}>
                  <Text style={{ color: colors.muted, fontSize: 13, flex: 1 }}>{ci.title}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12.5 }}>{ci.count} öğrenci</Text>
                </View>
              ))}
            </View>
          )}
          {!!d.per_student?.length && (
            <View>
              <Text style={{ color: colors.ink, fontSize: 13, fontWeight: "700", marginBottom: 4 }}>
                Öğrenci puanları (düşükten yükseğe)
              </Text>
              {d.per_student.map((p, i) => (
                <View
                  key={i}
                  style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: colors.line }}
                >
                  <Text style={{ color: colors.ink, fontSize: 13.5 }}>{p.student_name}</Text>
                  <Text
                    style={{
                      color: p.score < 60 ? colors.danger : p.score >= 80 ? colors.ok : colors.muted,
                      fontSize: 13.5,
                      fontWeight: "700",
                    }}
                  >
                    {p.score}/100
                  </Text>
                </View>
              ))}
            </View>
          )}
          {d.note ? <Text style={{ color: colors.faint, fontSize: 11.5 }}>{d.note}</Text> : null}
        </View>
      )}
      <Btn
        title={busy ? "Rapor hazırlanıyor…" : latest ? "Raporu yenile" : "Kod kalitesi raporu çıkar"}
        icon="sparkle"
        variant={latest ? "ghost" : "gold"}
        onPress={run}
        disabled={busy}
      />
    </View>
  );
}
