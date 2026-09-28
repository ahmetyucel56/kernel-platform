import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import {
  api,
  ApiError,
  runPrecheck,
  type PrecheckResult,
  type PrecheckStatus,
  type ReqStatus,
} from "./api";
import { Btn, Sparkle } from "./ui";
import { colors, radius } from "./theme";

const REQ_LABEL: Record<ReqStatus, string> = { met: "Tam", partial: "Kısmen", missing: "Eksik" };
const REQ_COLOR: Record<ReqStatus, string> = { met: colors.ok, partial: colors.gold, missing: colors.danger };

function fmt(iso: string) {
  return new Date(iso).toLocaleString("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Teslim öncesi ön kontrol (web'deki PrecheckPanel ile aynı). Teslim oluşturmaz. */
export function PrecheckCard({ assignmentId }: { assignmentId: string }) {
  const [st, setSt] = useState<PrecheckStatus | null>(null);
  const [result, setResult] = useState<PrecheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<PrecheckStatus>(`/assignments/${assignmentId}/precheck`)
      .then((s) => {
        setSt(s);
        setResult(s.history[0] ?? null);
      })
      .catch(() => {});
  }, [assignmentId]);

  async function pickAndCheck() {
    setErr(null);
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (res.canceled || !res.assets.length) return;
      setBusy(true);
      const out = await runPrecheck(
        assignmentId,
        res.assets.map((f) => ({ uri: f.uri, name: f.name, mimeType: f.mimeType, size: f.size }))
      );
      setResult(out.result);
      setSt(out.status);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Ön kontrol yapılamadı.");
    } finally {
      setBusy(false);
    }
  }

  if (!st || !st.enabled) return null;
  const canRun = st.available && st.remaining > 0 && !busy;
  const cov = result?.coverage ?? null;
  const covColor = cov == null ? colors.ink : cov >= 75 ? colors.ok : cov >= 50 ? colors.gold : colors.danger;

  return (
    <View style={{ backgroundColor: colors.bg3, borderRadius: radius.sm, padding: 12, marginTop: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><Sparkle size={15} /><Text style={{ color: colors.ink, fontSize: 14.5, fontWeight: "700" }}>Teslim öncesi ön kontrol</Text></View>
      <Text style={{ color: colors.muted, fontSize: 12.5, marginTop: 2 }}>
        Kodunu kurallara göre kontrol et; bu bir teslim değildir, notlanmaz.
      </Text>
      <View style={{ marginTop: 10 }}>
        <Btn
          title={busy ? "Kontrol ediliyor…" : "Dosya seç ve kontrol et"}
          variant="ghost"
          onPress={pickAndCheck}
          disabled={!canRun}
        />
      </View>
      <Text style={{ color: colors.faint, fontSize: 12, marginTop: 6 }}>
        {st.available
          ? st.remaining > 0
            ? `Kalan hak: ${st.remaining}/${st.limit} (24 saatte)`
            : `Hakkın doldu${st.resets_at ? ` · ${fmt(st.resets_at)} itibarıyla yeni hak` : ""}`
          : st.reason}
      </Text>
      {err && <Text style={{ color: colors.danger, fontSize: 13, marginTop: 6 }}>{err}</Text>}

      {result && (
        <View style={{ marginTop: 12 }}>
          <Text style={{ color: colors.ink, fontSize: 13 }}>
            <Text style={{ color: covColor, fontSize: 18, fontWeight: "800" }}>%{cov ?? "—"}</Text>
            {`  kapsam · ${result.met} tam · ${result.partial} kısmen · ${result.missing} eksik`}
          </Text>
          <Text style={{ color: colors.faint, fontSize: 11.5, marginTop: 2 }}>{fmt(result.created_at)}</Text>
          {result.items.map((it, i) => (
            <View key={i} style={{ borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 7, marginTop: 7 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                <Text style={{ color: colors.ink, fontSize: 13, flex: 1 }}>{it.requirement}</Text>
                <Text style={{ color: REQ_COLOR[it.status], fontSize: 12, fontWeight: "700" }}>
                  {REQ_LABEL[it.status]}
                </Text>
              </View>
              {it.status !== "met" && it.evidence ? (
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{it.evidence}</Text>
              ) : null}
            </View>
          ))}
          {result.missing + result.partial === 0 && (
            <Text style={{ color: colors.ok, fontSize: 13, marginTop: 8 }}>
              Tüm kurallar karşılanıyor görünüyor — teslim etmeye hazırsın.
            </Text>
          )}
        </View>
      )}
    </View>
  );
}
