import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { api, ApiError } from "../src/api";
import { useAuth, useDemoEnabled } from "../src/auth";
import { DemoButtons } from "../src/DemoButtons";
import { Accent, Btn, Card, Field, Icon, Muted, Screen, Select } from "../src/ui";
import { colors, fonts } from "../src/theme";
import { BRAND_NAME } from "../src/config";

const FALLBACK_UNIS = ["Demo Üniversitesi"];

export default function Login() {
  const { loginSchool, loginEmail } = useAuth();
  const demo = useDemoEnabled();
  const router = useRouter();
  const [universities, setUniversities] = useState<string[]>(FALLBACK_UNIS);
  const [uniLoading, setUniLoading] = useState(true);
  const [university, setUniversity] = useState("Demo Üniversitesi");
  const [schoolNo, setSchoolNo] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // "school": okul/personel no · "email": kurucu/yönetici (e-posta)
  const [mode, setMode] = useState<"school" | "email">("school");
  const [email, setEmail] = useState("");
  // İki adımlı doğrulama açıksa şifreden sonra kod adımı
  const [mfaToken, setMfaToken] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const list = await api<string[]>("/auth/universities", { auth: false });
        if (list.length) {
          setUniversities(list);
          setUniversity(list[0]);
        }
      } catch {
        /* API'ye ulaşılamazsa varsayılan listeyle devam */
      } finally {
        setUniLoading(false);
      }
    })();
  }, []);

  async function submit() {
    setErr(null);
    setBusy(true);
    try {
      const r =
        mode === "email"
          ? await loginEmail(email.trim(), password, remember)
          : await loginSchool(university.trim(), schoolNo.trim(), password, remember);
      setPassword("");
      if (r.done) router.replace("/(tabs)");
      else setMfaToken(r.mfaToken);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Giriş başarısız.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      {/* Yönetici girişi ekranda görünmez: logoya 2 sn basılı tutunca e-posta alanı açılır/kapanır. */}
      <Pressable
        onLongPress={() => {
          setErr(null);
          setMode((m) => (m === "email" ? "school" : "email"));
        }}
        delayLongPress={2000}
        style={{ marginTop: 30, marginBottom: 24, alignSelf: "flex-start" }}
      >
        <Text style={{ color: colors.ink, fontSize: 28, fontFamily: fonts.display }}>
          {BRAND_NAME}
          <Text style={{ color: colors.gold }}>.</Text>
        </Text>
      </Pressable>

      <Card>
        <Text style={{ color: colors.ink, fontSize: 23, fontFamily: fonts.display }}>Hesabına <Accent>giriş</Accent></Text>
        <Muted style={{ marginTop: 2, marginBottom: 12 }}>
          {mode === "email"
            ? "Yönetici hesabının e-postası ve şifresiyle giriş yap."
            : "Üniversiteni seç; okul/personel numaran ve şifrenle giriş yap."}
        </Muted>

        {mfaToken ? (
          <MfaStep mfaToken={mfaToken} remember={remember} onDone={() => router.replace("/(tabs)")}
            onCancel={() => setMfaToken(null)} />
        ) : (
        <>
        {mode === "school" && (
        <View
          style={{
            marginBottom: 16,
            paddingVertical: 10,
            paddingHorizontal: 12,
            borderRadius: 10,
            backgroundColor: colors.bg3,
            borderLeftWidth: 3,
            borderLeftColor: colors.gold,
          }}
        >
          <Muted style={{ fontSize: 12.5 }}>
            <Text style={{ color: colors.ink, fontWeight: "700" }}>Okul sistemine (Proliz/OBS) henüz bağlı değil. </Text>
            Okul şifrenle giriş yapılmaz; hesabını yönetici açar ve sana geçici bir şifre verir.
          </Muted>
        </View>
        )}

        {mode === "email" ? (
          <Field
            label="E-posta"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
          />
        ) : (
        <>
        <Select
          label="Üniversite"
          value={university}
          options={universities}
          onChange={setUniversity}
          loading={uniLoading}
        />
        <Field
          label="Öğrenci / Personel No"
          value={schoolNo}
          onChangeText={setSchoolNo}
          keyboardType="number-pad"
          autoCapitalize="none"
        />
        </>
        )}
        <Field
          label="Şifre"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
        />

        <Pressable
          onPress={() => setRemember((v) => !v)}
          style={{ flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 14, paddingVertical: 4 }}
        >
          <View
            style={{
              width: 20,
              height: 20,
              borderRadius: 5,
              borderWidth: 1.5,
              borderColor: remember ? colors.gold : colors.line2,
              backgroundColor: remember ? colors.gold : "transparent",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {remember && <Icon name="check" size={14} color={colors.onGold} />}
          </View>
          <Text style={{ color: colors.ink, fontSize: 14 }}>Beni hatırla</Text>
        </Pressable>

        {err && <Text style={{ color: colors.danger, marginBottom: 10 }}>{err}</Text>}
        <Btn title={busy ? "Giriş yapılıyor…" : "Giriş yap"} onPress={submit} disabled={busy} />
        </>
        )}

        {demo && !mfaToken && mode === "school" && (
          <View
            style={{
              marginTop: 16,
              padding: 14,
              borderRadius: 12,
              backgroundColor: colors.bg3,
              borderWidth: 1,
              borderColor: colors.line,
              gap: 10,
            }}
          >
            <Text style={{ color: colors.ink, fontFamily: fonts.ui, fontSize: 14 }}>Şifresiz dene</Text>
            <DemoButtons />
            <Muted style={{ fontSize: 12 }}>
              Elle giriş: Demo Üniversitesi · şifre parola123 · Öğrenci 2025001 / 2025002 · Hoca 9001
            </Muted>
          </View>
        )}
      </Card>

      <Pressable onPress={() => router.push("/intro")} style={{ alignSelf: "center", padding: 10 }} hitSlop={6}>
        <Text style={{ color: colors.blueSoft, fontSize: 14, fontFamily: fonts.ui }}>Kernel nedir? Kısa tanıtım</Text>
      </Pressable>
      <Pressable onPress={() => router.push("/aydinlatma")} style={{ alignSelf: "center", padding: 6, marginBottom: 10 }} hitSlop={6}>
        <Text style={{ color: colors.muted, fontSize: 12.5 }}>Kişisel verilerin korunması (KVKK)</Text>
      </Pressable>
    </Screen>
  );
}

/** Şifreden sonraki adım: doğrulayıcı uygulamadaki 6 haneli kod ya da yedek kod. */
function MfaStep({
  mfaToken,
  remember,
  onDone,
  onCancel,
}: {
  mfaToken: string;
  remember: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { verify2fa } = useAuth();
  const [code, setCode] = useState("");
  const [backup, setBackup] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setErr(null);
    setBusy(true);
    try {
      await verify2fa(mfaToken, code.trim(), remember);
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Doğrulanamadı.");
      if (e instanceof ApiError && e.message.includes("süresi")) onCancel();
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      <Muted style={{ marginBottom: 12 }}>
        {backup
          ? "Kaydettiğin yedek kodlardan birini gir (ör. a1b2-c3d4). Her kod bir kez çalışır."
          : "Doğrulayıcı uygulamada görünen 6 haneli kodu gir."}
      </Muted>
      <Field
        label={backup ? "Yedek kod" : "Doğrulama kodu"}
        value={code}
        onChangeText={(t) => setCode(backup ? t : t.replace(/\D/g, ""))}
        keyboardType={backup ? "default" : "number-pad"}
        autoCapitalize="none"
        autoComplete="one-time-code"
        maxLength={backup ? 12 : 6}
        autoFocus
      />
      {err && <Text style={{ color: colors.danger, marginBottom: 10 }}>{err}</Text>}
      <Btn title={busy ? "Doğrulanıyor…" : "Doğrula ve gir"} onPress={submit} disabled={busy || !code.trim()} />
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8 }}>
        <Pressable onPress={() => { setBackup(!backup); setCode(""); }} hitSlop={6} style={{ padding: 8 }}>
          <Text style={{ color: colors.blueSoft, fontSize: 13.5 }}>
            {backup ? "Uygulama koduyla gir" : "Telefonum yanımda değil"}
          </Text>
        </Pressable>
        <Pressable onPress={onCancel} hitSlop={6} style={{ padding: 8 }}>
          <Text style={{ color: colors.muted, fontSize: 13.5 }}>Geri</Text>
        </Pressable>
      </View>
    </View>
  );
}
