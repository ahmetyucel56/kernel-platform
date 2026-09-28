import { useState } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { ApiError } from "./api";
import { markIntroSeen, useAuth, type DemoRole } from "./auth";
import { Btn } from "./ui";
import { colors } from "./theme";

/** "Hoca olarak dene / Öğrenci olarak dene" (web'deki DemoButtons'ın aynısı). */
export function DemoButtons() {
  const { loginDemo } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState<DemoRole | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function go(role: DemoRole) {
    setErr(null);
    setBusy(role);
    try {
      await loginDemo(role);
      await markIntroSeen();
      router.replace("/(tabs)");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Demo girişi yapılamadı.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={{ gap: 8 }}>
      <Btn
        title={busy === "academician" ? "Açılıyor…" : "Hoca olarak dene"}
        variant="gold"
        onPress={() => go("academician")}
        disabled={busy !== null}
      />
      <Btn
        title={busy === "student" ? "Açılıyor…" : "Öğrenci olarak dene"}
        variant="ghost"
        onPress={() => go("student")}
        disabled={busy !== null}
      />
      {err && <Text style={{ color: colors.danger, fontSize: 13 }}>{err}</Text>}
    </View>
  );
}
