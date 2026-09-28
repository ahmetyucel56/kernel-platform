import { useEffect, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { api } from "../src/api";
import { PRIVACY_SECTIONS, PRIVACY_UPDATED } from "../src/privacy";
import { BackHeader, Card, Muted, Screen } from "../src/ui";
import { colors, fonts } from "../src/theme";

type Meta = { controller: string; contact: string | null };

/** KVKK aydınlatma metni (girişsiz de açılır). Web'deki /aydinlatma ile aynı içerik. */
export default function PrivacyScreen() {
  const [meta, setMeta] = useState<Meta | null>(null);
  useEffect(() => {
    api<Meta>("/meta/privacy", { auth: false }).then(setMeta).catch(() => {});
  }, []);

  return (
    <Screen>
      <BackHeader title="Kişisel verilerin korunması" subtitle={`KVKK aydınlatma metni · ${PRIVACY_UPDATED}`} />
      <Card>
        <Muted style={{ fontSize: 12.5 }}>Veri sorumlusu</Muted>
        <Text style={{ color: colors.ink, fontSize: 14.5, marginBottom: 10 }}>{meta?.controller ?? "…"}</Text>
        <Muted style={{ fontSize: 12.5 }}>Başvuru ve sorular</Muted>
        {meta?.contact ? (
          <Pressable onPress={() => Linking.openURL(`mailto:${meta.contact}`).catch(() => {})}>
            <Text style={{ color: colors.blueSoft, fontSize: 14.5 }}>{meta.contact}</Text>
          </Pressable>
        ) : (
          <Text style={{ color: colors.ink, fontSize: 14.5 }}>Hocan veya okulun aracılığıyla</Text>
        )}
      </Card>
      {PRIVACY_SECTIONS.map((s) => (
        <View key={s.title} style={{ marginBottom: 16 }}>
          <Text style={{ color: colors.ink, fontFamily: fonts.ui, fontSize: 16, marginBottom: 6 }}>{s.title}</Text>
          {s.paragraphs?.map((p, i) => (
            <Text key={i} style={{ color: colors.ink, fontSize: 14, lineHeight: 21, marginBottom: 6 }}>
              {p}
            </Text>
          ))}
          {s.bullets?.map((b, i) => (
            <View key={i} style={{ flexDirection: "row", gap: 8, marginBottom: 5 }}>
              <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 21 }}>•</Text>
              <Text style={{ color: colors.ink, fontSize: 14, lineHeight: 21, flex: 1 }}>{b}</Text>
            </View>
          ))}
        </View>
      ))}
      <Muted style={{ fontSize: 13, marginBottom: 20 }}>
        Haklarını kullanmak için yukarıdaki iletişim adresine yazabilirsin. Başvurular en geç 30 gün içinde yanıtlanır.
      </Muted>
    </Screen>
  );
}
