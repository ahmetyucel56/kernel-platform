import { useCallback, useState } from "react";
import { Alert, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { api, ApiError, type SecurityInfo, type SessionInfo, type TwoFactorSetup } from "../src/api";
import { useAuth } from "../src/auth";
import { fmtDateTime } from "../src/format";
import { AuthenticatorStep, BackupCodes, ChangePasswordForm } from "../src/SecurityParts";
import { deviceLabel, eventLabel, isBadEvent } from "../src/security";
import { BackHeader, Btn, Card, Chip, Field, Muted, Screen, SectionLabel } from "../src/ui";
import { colors, fonts } from "../src/theme";

/** Hesap güvenliği: şifre, iki adımlı doğrulama, tüm cihazlardan çıkış, son hareketler. */
export default function SecurityScreen() {
  const { user, applySession, refreshUser, logout } = useAuth();
  const router = useRouter();
  const [info, setInfo] = useState<SecurityInfo | null>(null);
  const [open, setOpen] = useState<null | "password" | "2fa" | "disable">(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [devices, setDevices] = useState<SessionInfo[]>([]);

  const load = useCallback(() => {
    api<SecurityInfo>("/auth/security").then(setInfo).catch(() => {});
    api<SessionInfo[]>("/auth/sessions").then(setDevices).catch(() => {});
  }, []);

  function closeSession(s: SessionInfo) {
    Alert.alert("Oturumu kapat", `${s.device} oturumu kapatılsın mı? O cihaz yeniden giriş yapmak zorunda kalır.`, [
      { text: "Vazgeç", style: "cancel" },
      {
        text: "Kapat",
        style: "destructive",
        onPress: async () => {
          try {
            await api(`/auth/sessions/${s.id}`, { method: "DELETE" });
          } finally {
            load();
          }
        },
      },
    ]);
  }
  useFocusEffect(load);

  if (!user) return null;

  function logoutAll() {
    Alert.alert("Tüm cihazlardan çıkış", "Bu cihaz dahil tüm oturumların kapansın mı? Yeniden giriş yapman gerekecek.", [
      { text: "Vazgeç", style: "cancel" },
      {
        text: "Çıkış yap",
        style: "destructive",
        onPress: async () => {
          try {
            await api("/auth/logout-all", { method: "POST" });
          } finally {
            await logout();
            router.replace("/login");
          }
        },
      },
    ]);
  }

  return (
    <Screen>
      <BackHeader title="Güvenlik" subtitle={user.full_name} />

      {user.is_demo ? (
        <Card>
          <Muted>
            Bu bir demo hesabı: şifresi herkese açık olduğundan şifre ve iki adımlı doğrulama ayarları kapalıdır.
            Kendi verini burada tutma.
          </Muted>
        </Card>
      ) : (
        <>
          {msg && <Text style={{ color: colors.ok, marginBottom: 10 }}>{msg}</Text>}
          <Card>
            <Text style={{ color: colors.ink, fontFamily: fonts.ui, fontSize: 15 }}>Şifre</Text>
            <Muted style={{ fontSize: 13, marginBottom: 10 }}>Değiştirince diğer cihazlardaki oturumların kapanır.</Muted>
            {open === "password" ? (
              <>
                <ChangePasswordForm
                  minLength={user.role === "admin" ? 14 : 10}
                  onDone={async (res) => {
                    await applySession(res);
                    setOpen(null);
                    setMsg("Şifren değiştirildi; diğer cihazlardaki oturumlar kapatıldı.");
                    load();
                  }}
                />
                <Btn small variant="ghost" title="Vazgeç" onPress={() => setOpen(null)} />
              </>
            ) : (
              <Btn small variant="ghost" icon="key" title="Şifreyi değiştir" onPress={() => setOpen("password")} />
            )}
          </Card>

          <Card>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <Text style={{ color: colors.ink, fontFamily: fonts.ui, fontSize: 15 }}>İki adımlı doğrulama</Text>
              <Chip text={info?.totp_enabled ? "Açık" : "Kapalı"} kind={info?.totp_enabled ? "ok" : "muted"} />
            </View>
            <Muted style={{ fontSize: 13, marginTop: 4, marginBottom: 10 }}>
              {info?.totp_enabled
                ? `${info.backup_codes_left} yedek kod kaldı. Şifren ele geçse bile telefonun olmadan girilemez.`
                : "Açarsan girişte şifreye ek olarak doğrulayıcı uygulamadaki kod istenir — önerilir."}
            </Muted>
            {open === "2fa" ? (
              <TwoFactorEnable
                onDone={() => {
                  load();
                  refreshUser().catch(() => {});
                }}
                onClose={() => setOpen(null)}
              />
            ) : open === "disable" ? (
              <TwoFactorDisable
                onCancel={() => setOpen(null)}
                onDone={() => {
                  setOpen(null);
                  setMsg("İki adımlı doğrulama kapatıldı.");
                  load();
                  refreshUser().catch(() => {});
                }}
              />
            ) : info?.totp_enabled ? (
              user.role === "admin" ? (
                <Muted style={{ fontSize: 12.5 }}>Yönetici hesabında zorunludur; kapatılamaz.</Muted>
              ) : (
                <Btn small variant="danger" title="Kapat" onPress={() => setOpen("disable")} />
              )
            ) : (
              <Btn small icon="shield" title="Aç" onPress={() => setOpen("2fa")} />
            )}
          </Card>

          <Card>
            <Text style={{ color: colors.ink, fontFamily: fonts.ui, fontSize: 15 }}>Tüm cihazlardan çıkış</Text>
            <Muted style={{ fontSize: 13, marginBottom: 10 }}>
              Başka bir yerde açık kaldığını düşündüğün oturumları kapatır.
            </Muted>
            <Btn small variant="ghost" icon="log-out" title="Tüm cihazlardan çık" onPress={logoutAll} />
          </Card>
        </>
      )}

      {devices.length > 0 && (
        <>
          <SectionLabel>Aktif oturumlar</SectionLabel>
          <Muted style={{ fontSize: 12, marginTop: -6, marginBottom: 10 }}>
            Hesabının açık olduğu cihazlar. Yeni bir cihazdan girildiğinde sana bildirim gelir.
          </Muted>
          <Card>
            {devices.map((s, i) => (
              <View
                key={s.id}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  paddingVertical: 8,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: colors.line,
                }}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: "row", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <Text style={{ color: colors.ink, fontSize: 14 }}>{s.device}</Text>
                    {s.current && <Chip text="Bu cihaz" kind="ok" />}
                  </View>
                  <Muted style={{ fontSize: 12 }}>
                    {s.client === "mobile" ? "uygulama" : "web"}
                    {s.ip ? ` · ${s.ip}` : ""} · son etkinlik {fmtDateTime(s.last_seen_at)}
                  </Muted>
                </View>
                {!s.current && <Btn small variant="danger" title="Kapat" onPress={() => closeSession(s)} />}
              </View>
            ))}
          </Card>
        </>
      )}

      <SectionLabel>Son hesap hareketleri</SectionLabel>
      <Muted style={{ fontSize: 12, marginTop: -6, marginBottom: 10 }}>
        Tanımadığın bir giriş görürsen hemen şifreni değiştir.
      </Muted>
      <Card>
        {!info ? (
          <Muted>Yükleniyor…</Muted>
        ) : info.events.length === 0 ? (
          <Muted>Henüz kayıt yok.</Muted>
        ) : (
          info.events.map((e, i) => (
            <View
              key={e.id}
              style={{ paddingVertical: 8, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.line, gap: 3 }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                <Chip text={eventLabel(e.event)} kind={isBadEvent(e.event) ? "danger" : "muted"} />
                <Muted style={{ fontSize: 11.5 }}>{fmtDateTime(e.created_at)}</Muted>
              </View>
              <Muted style={{ fontSize: 12.5 }}>
                {e.actor_name ? `yönetici: ${e.actor_name}` : `${deviceLabel(e.user_agent)}${e.ip ? ` · ${e.ip}` : ""}`}
              </Muted>
            </View>
          ))
        )}
      </Card>
    </Screen>
  );
}

function TwoFactorEnable({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    setErr(null);
    setBusy(true);
    try {
      setSetup(await api<TwoFactorSetup>("/auth/2fa/setup", { method: "POST", body: { password } }));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Başlatılamadı.");
    } finally {
      setBusy(false);
    }
  }

  async function enable(code: string) {
    setErr(null);
    setBusy(true);
    try {
      const r = await api<{ backup_codes: string[] }>("/auth/2fa/enable", { method: "POST", body: { code } });
      setCodes(r.backup_codes);
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Doğrulanamadı.");
    } finally {
      setBusy(false);
    }
  }

  if (codes) return <BackupCodes codes={codes} onClose={onClose} />;
  if (setup) return <AuthenticatorStep setup={setup} onCode={enable} busy={busy} err={err} />;
  return (
    <View>
      <Field label="Devam etmek için şifreni gir" value={password} onChangeText={setPassword} secureTextEntry
        autoCapitalize="none" />
      {err && <Text style={{ color: colors.danger, marginBottom: 10 }}>{err}</Text>}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Btn small title={busy ? "…" : "Devam"} onPress={start} disabled={busy || !password} />
        <Btn small variant="ghost" title="Vazgeç" onPress={onClose} />
      </View>
    </View>
  );
}

function TwoFactorDisable({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setErr(null);
    setBusy(true);
    try {
      await api("/auth/2fa/disable", { method: "POST", body: { password, code } });
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Kapatılamadı.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <View>
      <Muted style={{ fontSize: 13, marginBottom: 10 }}>
        Kapatırsan hesabın yalnızca şifreyle korunur. Onaylamak için şifreni ve güncel kodu gir.
      </Muted>
      <Field label="Şifre" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" />
      <Field label="Doğrulama kodu veya yedek kod" value={code} onChangeText={setCode} autoCapitalize="none" />
      {err && <Text style={{ color: colors.danger, marginBottom: 10 }}>{err}</Text>}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Btn small variant="danger" title={busy ? "…" : "Kapat"} onPress={submit} disabled={busy || !password || !code} />
        <Btn small variant="ghost" title="Vazgeç" onPress={onCancel} />
      </View>
    </View>
  );
}
