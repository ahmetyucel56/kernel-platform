import { useEffect, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { api, ApiError, type CommunityOut } from "../../src/api";
import { useAuth } from "../../src/auth";
import { canModerate } from "../../src/perm";
import { Btn, Card, H1, Loader, Muted, Screen, Tag } from "../../src/ui";
import { colors, radius } from "../../src/theme";

const SCOPE_LABEL: Record<string, string> = {
  class: "Sınıf",
  department: "Bölüm",
  general: "Genel",
};

export default function Community() {
  const router = useRouter();
  const { user } = useAuth();
  const [items, setItems] = useState<CommunityOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function load() {
    api<CommunityOut[]>("/communities").then(setItems).catch(() => {}).finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function create() {
    const n = name.trim();
    if (!n || creating) return;
    setErr(null);
    setCreating(true);
    try {
      await api("/communities", { method: "POST", body: { name: n, scope: "general" } });
      setName("");
      load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Oluşturulamadı.");
    } finally {
      setCreating(false);
    }
  }

  function removeCommunity(c: CommunityOut) {
    Alert.alert("Topluluğu sil", `"${c.name}" ve tüm gönderileri silinsin mi?`, [
      { text: "Vazgeç", style: "cancel" },
      {
        text: "Sil",
        style: "destructive",
        onPress: async () => {
          try {
            await api(`/communities/${c.id}`, { method: "DELETE" });
            load();
          } catch (e) {
            Alert.alert("Hata", e instanceof ApiError ? e.message : "Silinemedi.");
          }
        },
      },
    ]);
  }

  if (loading) return <Loader />;

  return (
    <Screen>
      <H1>Topluluk</H1>
      <Muted style={{ marginBottom: 18 }}>Soru sor, tartış, paylaş.</Muted>

      <Card>
        <Text style={{ color: colors.ink, fontSize: 15, fontWeight: "700", marginBottom: 10 }}>
          Yeni topluluk
        </Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Topluluk adı"
            placeholderTextColor={colors.faint}
            style={{
              flex: 1,
              color: colors.ink,
              backgroundColor: colors.bg,
              borderColor: colors.line2,
              borderWidth: 1,
              borderRadius: radius.sm,
              paddingHorizontal: 12,
              paddingVertical: 10,
              fontSize: 15,
            }}
          />
          <Btn title={creating ? "…" : "Oluştur"} variant="gold" onPress={create} disabled={creating} />
        </View>
        {err && <Text style={{ color: colors.danger, fontSize: 13, marginTop: 8 }}>{err}</Text>}
      </Card>

      <View style={{ marginTop: 8 }}>
        {items.length === 0 ? (
          <Card>
            <Muted>Henüz topluluk yok. İlk topluluğu sen oluştur.</Muted>
          </Card>
        ) : (
          items.map((c) => (
            <Pressable
              key={c.id}
              onPress={() => router.push({ pathname: "/community/[id]", params: { id: c.id } })}
            >
              <Card>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <Text style={{ color: colors.ink, fontSize: 16, fontWeight: "700", flex: 1 }}>
                    {c.name}
                  </Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <Tag text={SCOPE_LABEL[c.scope] ?? c.scope} color={colors.blueSoft} />
                    {canModerate(user, c.created_by) && (
                      <Pressable onPress={() => removeCommunity(c)} hitSlop={8}>
                        <Text style={{ color: colors.danger, fontSize: 12.5 }}>Sil</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
                <Muted style={{ fontSize: 12.5, marginTop: 6 }}>{c.post_count ?? 0} gönderi</Muted>
              </Card>
            </Pressable>
          ))
        )}
      </View>
    </Screen>
  );
}
