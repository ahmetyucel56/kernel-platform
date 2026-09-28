import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { api, type NotificationItem } from "../src/api";
import { BackHeader, Card, Loader, Muted, Screen, Tag } from "../src/ui";
import { colors } from "../src/theme";

const KIND_LABEL: Record<string, string> = {
  graded: "Not",
  comment: "Yorum",
  submission: "Gönderim",
  assignment: "Yeni ödev",
  reopen: "Uzatma",
};

function fmt(iso: string) {
  return new Date(iso).toLocaleString("tr-TR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Notifications() {
  const router = useRouter();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    api<NotificationItem[]>("/me/notifications")
      .then(setItems)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useFocusEffect(useCallback(() => load(), [load]));

  async function open(n: NotificationItem) {
    if (!n.is_read) {
      try {
        await api(`/me/notifications/${n.id}/read`, { method: "POST" });
      } catch {
        /* yut */
      }
    }
    if (n.submission_id) {
      router.push({ pathname: "/submission/[id]", params: { id: n.submission_id } });
    } else if (n.assignment_id) {
      router.push("/(tabs)/assignments");
    } else {
      load();
    }
  }

  async function markAll() {
    try {
      await api("/me/notifications/read-all", { method: "POST" });
    } catch {
      /* yut */
    }
    load();
  }

  if (loading) return <Loader />;

  const unread = items.filter((i) => !i.is_read).length;

  return (
    <Screen>
      <BackHeader />

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <Text style={{ color: colors.ink, fontSize: 24, fontWeight: "800" }}>
          Bildirimler{unread > 0 ? ` (${unread})` : ""}
        </Text>
        {unread > 0 && (
          <Pressable onPress={markAll}>
            <Text style={{ color: colors.blueSoft, fontSize: 13 }}>Tümünü okundu</Text>
          </Pressable>
        )}
      </View>

      {items.length === 0 ? (
        <Card>
          <Muted>Henüz bildirimin yok.</Muted>
        </Card>
      ) : (
        items.map((n) => (
          <Pressable key={n.id} onPress={() => open(n)}>
            <Card
              style={{
                borderLeftWidth: n.is_read ? 1 : 3,
                borderLeftColor: n.is_read ? colors.line : colors.gold,
                backgroundColor: n.is_read ? colors.bg2 : colors.bg3,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Tag text={KIND_LABEL[n.kind] ?? n.kind} color={colors.blueSoft} />
                <Muted style={{ fontSize: 11, marginLeft: "auto" }}>{fmt(n.created_at)}</Muted>
              </View>
              <Text style={{ color: colors.ink, fontSize: 14.5, marginTop: 8, lineHeight: 20 }}>
                {n.message}
              </Text>
              {n.submission_id ? (
                <Muted style={{ fontSize: 12, marginTop: 4 }}>Görüntülemek için dokun →</Muted>
              ) : null}
            </Card>
          </Pressable>
        ))
      )}
    </Screen>
  );
}
