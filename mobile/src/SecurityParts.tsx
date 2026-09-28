import { useState } from "react";
import { Image, Linking, Platform, Share, Text, View } from "react-native";
import { api, ApiError, type TokenResponse, type TwoFactorSetup } from "./api";
import { PASSWORD_RULES } from "./security";
import { colors, fonts } from "./theme";
import { Btn, Field, Muted } from "./ui";

/** Şifre değiştirme formu. Başarıda sunucu yeni oturum döndürür (diğer cihazlar kapanır). */
export function ChangePasswordForm({
  onDone,
  minLength = 10,
  submitLabel = "Şifreyi değiştir",
}: {
  onDone: (res: TokenResponse) => void | Promise<void>;
  minLength?: number;
  submitLabel?: string;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setErr(null);
    if (next !== again) return setErr("Yeni şifreler aynı değil.");
    if (next.length < minLength) return setErr(`Yeni şifre en az ${minLength} karakter olmalı.`);
    setBusy(true);
    try {
      const res = await api<TokenResponse>("/auth/change-password", {
        method: "POST",
        body: { current_password: current, new_password: next },
      });
      setCurrent("");
      setNext("");
      setAgain("");
      await onDone(res);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Şifre değiştirilemedi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      <Field label="Mevcut şifre" value={current} onChangeText={setCurrent} secureTextEntry autoCapitalize="none" />
      <Field label="Yeni şifre" value={next} onChangeText={setNext} secureTextEntry autoCapitalize="none" />
      <Field label="Yeni şifre (tekrar)" value={again} onChangeText={setAgain} secureTextEntry autoCapitalize="none" />
      <Muted style={{ fontSize: 12, marginTop: -6, marginBottom: 12 }}>{PASSWORD_RULES}</Muted>
      {err && <Text style={{ color: colors.danger, marginBottom: 10 }}>{err}</Text>}
      <Btn title={busy ? "Kaydediliyor…" : submitLabel} onPress={submit} disabled={busy || !current || !next} />
    </View>
  );
}

/** Yedek kodlar: yalnızca bir kez gösterilir; paylaş menüsüyle şifre yöneticisine/notlara kaydedilir. */
export function BackupCodes({ codes, onClose }: { codes: string[]; onClose?: () => void }) {
  return (
    <View
      style={{
        padding: 14,
        borderRadius: 12,
        backgroundColor: colors.bg3,
        borderLeftWidth: 3,
        borderLeftColor: colors.gold,
      }}
    >
      <Text style={{ color: colors.ink, fontFamily: fonts.ui, fontSize: 15 }}>Yedek kodların</Text>
      <Muted style={{ fontSize: 13, marginTop: 4 }}>
        Telefonuna erişemezsen bu kodlarla girersin; her biri bir kez çalışır. Şimdi güvenli bir yere kaydet. Bu
        kodlar bir daha gösterilmeyecek.
      </Muted>
      <View style={{ flexDirection: "row", flexWrap: "wrap", marginVertical: 12 }}>
        {codes.map((c) => (
          <Text
            key={c}
            selectable
            style={{
              width: "50%",
              color: colors.ink,
              fontSize: 16,
              paddingVertical: 4,
              fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
            }}
          >
            {c}
          </Text>
        ))}
      </View>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <Btn
          small
          variant="ghost"
          icon="share"
          title="Kaydet / paylaş"
          onPress={() =>
            Share.share({ message: `Kernel yedek kodları (her biri bir kez kullanılır)\n\n${codes.join("\n")}` }).catch(() => {})
          }
        />
        {onClose && <Btn small title="Kaydettim" onPress={onClose} />}
      </View>
    </View>
  );
}

/** QR + elle giriş anahtarı + "uygulamada aç" + doğrulama kodu. */
export function AuthenticatorStep({
  setup,
  onCode,
  busy,
  err,
}: {
  setup: TwoFactorSetup;
  onCode: (code: string) => void;
  busy: boolean;
  err: string | null;
}) {
  const [code, setCode] = useState("");
  return (
    <View>
      <Muted style={{ fontSize: 13.5, marginBottom: 10 }}>
        1) Bir doğrulayıcı uygulama kur (Google Authenticator, Microsoft Authenticator…). 2) Aşağıdaki düğmeyle
        anahtarı uygulamaya ekle — ya da QR'ı başka bir cihazdan okut veya anahtarı elle gir. 3) Uygulamadaki 6
        haneli kodu yaz.
      </Muted>
      <Btn
        variant="ghost"
        icon="external-link"
        title="Doğrulayıcı uygulamada aç"
        onPress={() => Linking.openURL(setup.otpauth_uri).catch(() => {})}
      />
      <View style={{ flexDirection: "row", gap: 14, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
        <Image source={{ uri: setup.qr }} style={{ width: 150, height: 150, borderRadius: 8, backgroundColor: "#fff" }} />
        <View style={{ flex: 1, minWidth: 140 }}>
          <Muted style={{ fontSize: 12 }}>Elle giriş anahtarı:</Muted>
          <Text selectable style={{ color: colors.ink, fontSize: 13.5, marginTop: 2 }}>
            {setup.secret.replace(/(.{4})/g, "$1 ").trim()}
          </Text>
        </View>
      </View>
      <View style={{ marginTop: 14 }}>
        <Field
          label="6 haneli kod"
          value={code}
          onChangeText={(t) => setCode(t.replace(/\D/g, ""))}
          keyboardType="number-pad"
          maxLength={6}
          autoComplete="one-time-code"
        />
      </View>
      {err && <Text style={{ color: colors.danger, marginBottom: 10 }}>{err}</Text>}
      <Btn title={busy ? "Doğrulanıyor…" : "Doğrula"} onPress={() => onCode(code)} disabled={busy || code.length !== 6} />
    </View>
  );
}
