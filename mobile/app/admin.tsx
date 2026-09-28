import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, Share, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import {
  api,
  ApiError,
  type AdminSettings,
  type AdminStats,
  type AdminUser,
  type SecurityEvent,
} from "../src/api";
import { useAuth } from "../src/auth";
import { fmtDateTime } from "../src/format";
import { deviceLabel, eventLabel, isBadEvent } from "../src/security";
import { BackHeader, Btn, Card, Chip, Field, Muted, Screen, Segmented, StatTile } from "../src/ui";
import { colors, fonts } from "../src/theme";

type Tab = "overview" | "users" | "events";
const ROLE: Record<string, string> = { student: "Öğrenci", academician: "Akademisyen", admin: "Yönetici" };

function confirm(title: string, message: string, action: string): Promise<boolean> {
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: "Vazgeç", style: "cancel", onPress: () => resolve(false) },
      { text: action, style: "destructive", onPress: () => resolve(true) },
    ])
  );
}

/** Kurucu paneli (web'deki Yönetim sayfasının karşılığı). */
export default function AdminScreen() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("overview");
  const [eventUser, setEventUser] = useState<AdminUser | null>(null);
  if (!user || user.role !== "admin") {
    return (
      <Screen>
        <BackHeader title="Yönetim" />
        <Muted>Bu ekran yalnızca yöneticiye açıktır.</Muted>
      </Screen>
    );
  }
  return (
    <Screen>
      <BackHeader title="Yönetim" subtitle="Hesaplar ve güvenlik" />
      <Segmented<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { key: "overview", label: "Genel" },
          { key: "users", label: "Kullanıcılar" },
          { key: "events", label: "Kayıtlar" },
        ]}
      />
      {tab === "overview" && <Overview onShowEvents={() => setTab("events")} />}
      {tab === "users" && (
        <Users
          onShowEvents={(u) => {
            setEventUser(u);
            setTab("events");
          }}
        />
      )}
      {tab === "events" && <Events user={eventUser} onClearUser={() => setEventUser(null)} />}
    </Screen>
  );
}

/* ---------------- Genel bakış + ayarlar ---------------- */
function Overview({ onShowEvents }: { onShowEvents: () => void }) {
  const [s, setS] = useState<AdminStats | null>(null);
  const [cfg, setCfg] = useState<AdminSettings | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    api<AdminStats>("/admin/stats").then(setS).catch(() => {});
    api<AdminSettings>("/admin/settings").then(setCfg).catch(() => {});
  }, []);
  useFocusEffect(load);

  async function toggleDemo() {
    if (!cfg) return;
    try {
      setCfg(await api<AdminSettings>("/admin/settings", { method: "PUT", body: { demo_login: !cfg.demo_login } }));
      setMsg(cfg.demo_login ? "Demo girişi kapatıldı." : "Demo girişi açıldı.");
    } catch (e) {
      Alert.alert("Hata", e instanceof ApiError ? e.message : "Kaydedilemedi.");
    }
  }

  async function purgeDemo() {
    const ok = await confirm(
      "Demo verisini sil",
      `Tüm demo hesapları (${s?.demo_users ?? 0}) ve onların sınıfları, ödevleri, teslimleri KALICI olarak silinecek; demo girişi kapanacak. Geri alınamaz.`,
      "Devam"
    );
    if (!ok || !(await confirm("Emin misin?", "Bu işlem geri alınamaz.", "Kalıcı olarak sil"))) return;
    try {
      const r = await api<{ deleted: number }>("/admin/demo/purge", { method: "POST" });
      setMsg(`${r.deleted} demo hesap ve verileri silindi; demo girişi kapatıldı.`);
      load();
    } catch (e) {
      Alert.alert("Hata", e instanceof ApiError ? e.message : "Silinemedi.");
    }
  }

  if (!s) return <Muted>Yükleniyor…</Muted>;
  const rows: [string, number, string][][] = [
    [["Öğrenci", s.users.student ?? 0, "hesap"], ["Akademisyen", s.users.academician ?? 0, "hesap"]],
    [["Sınıf", s.classes, "toplam"], ["Ödev", s.assignments, "toplam"]],
    [["Teslim", s.submissions, "toplam"], ["AI analizi", s.analyses_7d, "son 7 gün"]],
    [["Topluluk", s.communities, "toplam"], ["Demo hesap", s.demo_users, "tanıtım"]],
  ];
  return (
    <View>
      {rows.map((r, i) => (
        <View key={i} style={{ flexDirection: "row", gap: 10, marginBottom: 10 }}>
          {r.map(([label, value, sub]) => (
            <StatTile key={label} label={label} value={value} sub={sub} />
          ))}
        </View>
      ))}
      {(s.failed_logins_24h > 0 || s.locked_users > 0) && (
        <Card style={{ borderColor: colors.danger }}>
          <Text style={{ color: colors.ink }}>
            Son 24 saatte {s.failed_logins_24h} hatalı giriş denemesi · {s.locked_users} kilitli hesap.
          </Text>
          <Pressable onPress={onShowEvents} style={{ marginTop: 6 }}>
            <Text style={{ color: colors.blueSoft }}>Kayıtlara bak</Text>
          </Pressable>
        </Card>
      )}
      {msg && <Text style={{ color: colors.ok, marginBottom: 10 }}>{msg}</Text>}
      {cfg && (
        <Card>
          <Text style={{ color: colors.ink, fontFamily: fonts.ui, fontSize: 15 }}>Demo girişi</Text>
          <Muted style={{ fontSize: 13, marginBottom: 10 }}>
            {cfg.demo_login
              ? "Açık: giriş ekranında herkes şifresiz demo hesaplarla girebilir."
              : "Kapalı: demo düğmeleri görünmez, demo hesaplarla giriş yapılamaz."}
          </Muted>
          <Btn small variant={cfg.demo_login ? "ghost" : "primary"} title={cfg.demo_login ? "Kapat" : "Aç"} onPress={toggleDemo} />
          <View style={{ height: 1, backgroundColor: colors.line, marginVertical: 14 }} />
          <Text style={{ color: colors.ink, fontFamily: fonts.ui, fontSize: 15 }}>Demo verisini sil</Text>
          <Muted style={{ fontSize: 13, marginBottom: 10 }}>
            Tanıtım bittiğinde: tüm demo hesapları, tanıtım sınıfları ve teslimleri kalıcı olarak siler.
          </Muted>
          <Btn small variant="danger" title="Demo verisini sil" onPress={purgeDemo} disabled={!s.demo_users} />
          {!cfg.jwt_secret_from_env && (
            <Muted style={{ fontSize: 12.5, marginTop: 12 }}>
              ⚠ Oturum anahtarı (JWT_SECRET) sunucu ortamında tanımlı değil; Render'da tanımlaman önerilir.
            </Muted>
          )}
        </Card>
      )}
    </View>
  );
}

/* ---------------- Kullanıcılar ---------------- */
function Users({ onShowEvents }: { onShowEvents: (u: AdminUser) => void }) {
  const [list, setList] = useState<AdminUser[] | null>(null);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"" | "normal" | "demo" | "locked">("");
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ user: AdminUser; temp_password: string; why: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (kind) p.set("kind", kind);
    api<AdminUser[]>(`/admin/users?${p}`).then(setList).catch(() => setList([]));
  }, [q, kind]);
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  async function act(u: AdminUser, action: string) {
    const name = u.full_name;
    try {
      if (action === "reset") {
        if (!(await confirm("Şifre sıfırla", `${name} için geçici şifre oluşturulsun mu? Açık oturumları kapanır.`, "Sıfırla"))) return;
        const r = await api<{ user: AdminUser; temp_password: string }>(`/admin/users/${u.id}/reset-password`, { method: "POST" });
        setSecret({ ...r, why: "Şifre sıfırlandı" });
      } else if (action === "logout") {
        await api(`/admin/users/${u.id}/logout`, { method: "POST" });
        Alert.alert("Tamam", `${name} için tüm oturumlar kapatıldı.`);
      } else if (action === "unlock") {
        await api(`/admin/users/${u.id}/unlock`, { method: "POST" });
      } else if (action === "2fa") {
        if (!(await confirm("2FA sıfırla", `${name} için iki adımlı doğrulama kapatılsın mı?`, "Sıfırla"))) return;
        await api(`/admin/users/${u.id}/reset-2fa`, { method: "POST" });
      } else if (action === "toggle") {
        if (u.is_active && !(await confirm("Devre dışı bırak", `${name} hemen çıkış yapar ve giremez.`, "Devre dışı bırak"))) return;
        await api(`/admin/users/${u.id}`, { method: "PATCH", body: { is_active: !u.is_active } });
      } else if (action === "delete") {
        const what =
          u.role === "academician"
            ? "sınıfları, ödevleri ve o ödevlere yapılan TÜM teslimlerle birlikte"
            : "teslimleri, ön kontrolleri ve mesajlarıyla birlikte";
        if (!(await confirm("Kalıcı sil", `${name} ${what} silinecek. Yalnızca girişi engellemek için "Devre dışı bırak"ı kullan.`, "Devam"))) return;
        if (!(await confirm("Emin misin?", "Bu işlem geri alınamaz.", "Kalıcı olarak sil"))) return;
        await api(`/admin/users/${u.id}`, { method: "DELETE" });
        setOpen(null);
      }
      load();
    } catch (e) {
      Alert.alert("Hata", e instanceof ApiError ? e.message : "İşlem başarısız.");
    }
  }

  return (
    <View>
      <Field label="Ara" value={q} onChangeText={setQ} placeholder="Ad, numara veya e-posta" autoCapitalize="none" />
      <Segmented<"" | "normal" | "demo" | "locked">
        value={kind}
        onChange={setKind}
        options={[
          { key: "", label: "Tümü" },
          { key: "normal", label: "Gerçek" },
          { key: "demo", label: "Demo" },
          { key: "locked", label: "Kilitli" },
        ]}
      />
      <Btn icon={creating ? "x" : "user-plus"} variant={creating ? "ghost" : "primary"} title={creating ? "Vazgeç" : "Yeni hesap"}
        onPress={() => setCreating(!creating)} />
      <View style={{ height: 12 }} />
      {creating && (
        <CreateUser
          onCreated={(r) => {
            setSecret({ ...r, why: "Hesap açıldı" });
            setCreating(false);
            load();
          }}
        />
      )}
      {secret && <TempPassword data={secret} onClose={() => setSecret(null)} />}

      {!list ? (
        <Muted>Yükleniyor…</Muted>
      ) : list.length === 0 ? (
        <Muted>Kullanıcı bulunamadı.</Muted>
      ) : (
        list.map((u) => {
          const locked = u.is_founder || u.role === "admin";
          return (
            <Card key={u.id} style={{ opacity: u.is_active ? 1 : 0.65 }}>
              <Pressable onPress={() => !locked && setOpen(open === u.id ? null : u.id)} disabled={locked}>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                  <Text style={{ color: colors.ink, fontFamily: fonts.ui, fontSize: 15 }}>{u.full_name}</Text>
                  {u.is_founder && <Chip text="Kurucu" kind="gold" />}
                  {u.is_demo && <Chip text="Demo" />}
                  {!u.is_active && <Chip text="Devre dışı" kind="danger" />}
                  {u.locked && <Chip text="Kilitli" kind="danger" />}
                  {u.totp_enabled && <Chip text="2FA" kind="ok" />}
                  {u.must_change_password && <Chip text="Şifre değişmeli" />}
                </View>
                <Muted style={{ fontSize: 12.5, marginTop: 3 }}>
                  {ROLE[u.role] ?? u.role}
                  {u.school_no ? ` · ${u.school_no}` : ` · ${u.email}`}
                  {" · "}
                  {u.last_login_at ? `son giriş ${fmtDateTime(u.last_login_at)}` : "hiç giriş yapmadı"}
                </Muted>
                {locked && <Muted style={{ fontSize: 12, marginTop: 3 }}>Korumalı hesap</Muted>}
              </Pressable>
              {open === u.id && !locked && (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                  <Btn small variant="ghost" title="Şifre sıfırla" onPress={() => act(u, "reset")} />
                  <Btn small variant="ghost" title="Oturumlarını kapat" onPress={() => act(u, "logout")} />
                  {u.locked && <Btn small variant="ghost" title="Kilidi aç" onPress={() => act(u, "unlock")} />}
                  {u.totp_enabled && <Btn small variant="ghost" title="2FA sıfırla" onPress={() => act(u, "2fa")} />}
                  <Btn small variant="ghost" title="Kayıtlarını gör" onPress={() => onShowEvents(u)} />
                  <Btn small variant="ghost" title={u.is_active ? "Devre dışı bırak" : "Etkinleştir"} onPress={() => act(u, "toggle")} />
                  <Btn small variant="danger" title="Kalıcı sil" onPress={() => act(u, "delete")} />
                </View>
              )}
            </Card>
          );
        })
      )}
    </View>
  );
}

function CreateUser({ onCreated }: { onCreated: (r: { user: AdminUser; temp_password: string }) => void }) {
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<"student" | "academician">("student");
  const [no, setNo] = useState("");
  const [university, setUniversity] = useState("Demo Üniversitesi");
  const [demo, setDemo] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setErr(null);
    setBusy(true);
    try {
      onCreated(
        await api<{ user: AdminUser; temp_password: string }>("/admin/users", {
          method: "POST",
          body: { full_name: fullName, role, school_no: no, university, is_demo: demo },
        })
      );
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Oluşturulamadı.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <Segmented<"student" | "academician">
        value={role}
        onChange={setRole}
        options={[
          { key: "student", label: "Öğrenci" },
          { key: "academician", label: "Akademisyen" },
        ]}
      />
      <Field label="Ad Soyad" value={fullName} onChangeText={setFullName} />
      <Field label={role === "student" ? "Öğrenci No (giriş adı)" : "Personel No (giriş adı)"} value={no}
        onChangeText={setNo} autoCapitalize="none" />
      <Field label="Üniversite" value={university} onChangeText={setUniversity} />
      <Segmented<"normal" | "demo">
        value={demo ? "demo" : "normal"}
        onChange={(v) => setDemo(v === "demo")}
        options={[
          { key: "normal", label: "Gerçek hesap" },
          { key: "demo", label: "Demo hesabı" },
        ]}
      />
      <Muted style={{ fontSize: 12, marginTop: -6, marginBottom: 12 }}>
        Geçici bir şifre üretilir ve yalnızca bir kez gösterilir. Gerçek hesaplar ilk girişte kendi şifresini belirler;
        demo hesapların şifresi değiştirilemez.
      </Muted>
      {err && <Text style={{ color: colors.danger, marginBottom: 10 }}>{err}</Text>}
      <Btn title={busy ? "Oluşturuluyor…" : "Hesabı oluştur"} onPress={submit} disabled={busy || !fullName.trim() || !no.trim()} />
    </Card>
  );
}

function TempPassword({ data, onClose }: { data: { user: AdminUser; temp_password: string; why: string }; onClose: () => void }) {
  return (
    <Card style={{ borderColor: colors.gold }}>
      <Text style={{ color: colors.ink, fontFamily: fonts.ui, fontSize: 15 }}>
        {data.why}: {data.user.full_name}
      </Text>
      <Muted style={{ fontSize: 13, marginVertical: 6 }}>
        Giriş: {data.user.university} · {data.user.school_no}. Geçici şifre yalnızca şimdi gösteriliyor; kişiye yüz
        yüze ya da güvenli bir kanaldan ilet.
        {data.user.must_change_password ? " İlk girişte kendi şifresini belirleyecek." : ""}
      </Muted>
      <Text selectable style={{ color: colors.ink, fontSize: 20, letterSpacing: 1, marginBottom: 10 }}>
        {data.temp_password}
      </Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Btn small variant="ghost" icon="share" title="Paylaş"
          onPress={() => Share.share({ message: data.temp_password }).catch(() => {})} />
        <Btn small title="Tamam" onPress={onClose} />
      </View>
    </Card>
  );
}

/* ---------------- Güvenlik kayıtları ---------------- */
function Events({ user, onClearUser }: { user: AdminUser | null; onClearUser: () => void }) {
  const [only, setOnly] = useState<"all" | "fail">("all");
  const [rows, setRows] = useState<SecurityEvent[] | null>(null);
  useEffect(() => {
    const p = new URLSearchParams({ limit: "150" });
    if (only === "fail") p.set("only", "fail");
    if (user) p.set("user_id", user.id);
    setRows(null);
    api<SecurityEvent[]>(`/admin/events?${p}`).then(setRows).catch(() => setRows([]));
  }, [only, user]);
  return (
    <View>
      <Segmented<"all" | "fail">
        value={only}
        onChange={setOnly}
        options={[
          { key: "all", label: "Tümü" },
          { key: "fail", label: "Yalnızca şüpheli" },
        ]}
      />
      {user && (
        <Pressable onPress={onClearUser} style={{ marginBottom: 10 }}>
          <Text style={{ color: colors.blueSoft }}>{user.full_name} · filtreyi kaldır ×</Text>
        </Pressable>
      )}
      {!rows ? (
        <Muted>Yükleniyor…</Muted>
      ) : rows.length === 0 ? (
        <Muted>Kayıt yok.</Muted>
      ) : (
        <Card>
          {rows.map((e, i) => (
            <View key={e.id} style={{ paddingVertical: 8, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.line, gap: 3 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                <Chip text={eventLabel(e.event)} kind={isBadEvent(e.event) ? "danger" : "muted"} />
                <Muted style={{ fontSize: 11.5 }}>{fmtDateTime(e.created_at)}</Muted>
              </View>
              <Text style={{ color: colors.ink, fontSize: 13.5 }}>
                {e.user_name ?? ""}
                {e.actor_name ? `  · işlemi yapan: ${e.actor_name}` : ""}
              </Text>
              <Muted style={{ fontSize: 12 }}>
                {e.detail ? `${e.detail} · ` : ""}
                {e.user_agent || e.ip ? `${deviceLabel(e.user_agent)}${e.ip ? ` · ${e.ip}` : ""}` : ""}
              </Muted>
            </View>
          ))}
        </Card>
      )}
    </View>
  );
}
