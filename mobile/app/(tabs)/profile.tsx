import { View, Text } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../../src/auth";
import { Btn, Card, H1, Muted, Screen, SectionLabel, Segmented } from "../../src/ui";
import { colors } from "../../src/theme";
import { useThemeMode, type ThemePref } from "../../src/themeMode";

const roleLabel: Record<string, string> = {
  student: "Öğrenci",
  academician: "Akademisyen",
  admin: "Yönetici",
};

export default function Profile() {
  const { user, logout } = useAuth();
  const { pref, setPref } = useThemeMode();
  const router = useRouter();

  const rows: [string, string][] = user
    ? [
        ["Ad Soyad", user.full_name],
        ["Rol", user.is_founder ? "Kurucu" : roleLabel[user.role] ?? user.role],
        ...(user.school_no ? ([["Okul / Personel No", user.school_no]] as [string, string][]) : []),
        ...(user.university ? ([["Üniversite", user.university]] as [string, string][]) : []),
        // Öğrencinin dahili e-postası gösterilmez (okul numarasıyla giriş yapar)
        ...(user.role === "student" ? [] : ([["E-posta", user.email]] as [string, string][])),
      ]
    : [];

  return (
    <Screen>
      <H1>Profil</H1>
      <Card style={{ marginTop: 10 }}>
        {rows.map(([k, v], i) => (
          <View
            key={k}
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              gap: 12,
              paddingVertical: 12,
              borderTopWidth: i === 0 ? 0 : 1,
              borderTopColor: colors.line,
            }}
          >
            <Muted style={{ fontSize: 13 }}>{k}</Muted>
            <Text style={{ color: colors.ink, fontWeight: "500", flexShrink: 1, textAlign: "right" }}>{v}</Text>
          </View>
        ))}
      </Card>

      <SectionLabel style={{ marginTop: 8 }}>Hesap</SectionLabel>
      <View style={{ gap: 10, marginBottom: 18 }}>
        {user?.role === "admin" && (
          <Btn title="Yönetim paneli" icon="shield" variant="gold" onPress={() => router.push("/admin")} />
        )}
        <Btn
          title={user?.is_demo ? "Güvenlik (demo hesabı)" : `Güvenlik · 2FA ${user?.totp_enabled ? "açık" : "kapalı"}`}
          icon="lock"
          variant="ghost"
          onPress={() => router.push("/security")}
        />
        <Btn title="Kişisel verilerin korunması (KVKK)" icon="file-text" variant="ghost"
          onPress={() => router.push("/aydinlatma")} />
      </View>

      <SectionLabel>Görünüm</SectionLabel>
      <Segmented<ThemePref>
        value={pref}
        onChange={setPref}
        options={[
          { key: "system", label: "Sistem" },
          { key: "dark", label: "Koyu" },
          { key: "light", label: "Açık" },
        ]}
      />
      <Muted style={{ fontSize: 12, marginTop: -6, marginBottom: 18 }}>
        "Sistem" telefonunun açık/koyu ayarını izler. Web'deki tema düğmesiyle aynı renkler.
      </Muted>

      <Btn
        title="Çıkış yap"
        icon="log-out"
        variant="ghost"
        onPress={async () => {
          await logout();
          router.replace("/login");
        }}
      />
    </Screen>
  );
}
