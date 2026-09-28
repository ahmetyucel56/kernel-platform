import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { markIntroSeen, useDemoEnabled } from "../src/auth";
import { DemoButtons } from "../src/DemoButtons";
import { Accent, Btn, Icon, Sparkle, type IconName } from "../src/ui";
import { colors, fonts, radius } from "../src/theme";

/** İlk açılışta bir kez gösterilen kısa tanıtım (web ana sayfasının özeti). */
type Page = { kicker: string; title: [string, string]; icon: IconName | "sparkle"; points: string[] };

const PAGES: Page[] = [
  {
    kicker: "Kernel nedir?",
    title: ["Programlama ödevleri için ", "hocanın yardımcısı."],
    icon: "sparkle",
    points: [
      "Öğrenci projesini yükler; hocanın her kuralının kodda karşılanıp karşılanmadığı kanıtıyla gösterilir.",
      "Kod kalitesi ve kopya riski raporlanır.",
      "Yapay zeka yalnızca hoca istediğinde çalışır; notu her zaman hoca verir.",
    ],
  },
  {
    kicker: "Hoca için",
    title: ["Neye bakman gerektiğini ", "tek bakışta gör."],
    icon: "check-square",
    points: [
      "Notlanmayı bekleyen, bu hafta biten, yüksek benzerlik ve teslim etmeyenler panoda.",
      "Kodu satır satır incele, yorum bırak; AI not önerir, sen karar verirsin.",
      "Sınıf özetiyle ortak eksikleri gör, öğrencilere gönder; notları Excel'e aktar.",
    ],
  },
  {
    kicker: "Öğrenci için",
    title: ["Teslim etmeden önce ", "eksiğini gör."],
    icon: "upload-cloud",
    points: [
      "Projeni ZIP olarak yükle; her yükleme yeni bir sürüm olur.",
      "Hoca izin verirse ön kontrolle hangi kuralın eksik olduğunu önceden öğren.",
      "Satır yorumlarını, notunu ve AI geri bildirimini oku; AI mentora sor.",
    ],
  },
];

export default function Intro() {
  const router = useRouter();
  const demo = useDemoEnabled();
  const [i, setI] = useState(0);
  const page = PAGES[i];
  const last = i === PAGES.length - 1;

  async function finish() {
    await markIntroSeen();
    router.replace("/login");
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={["top", "left", "right", "bottom"]}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingTop: 8 }}>
        <Text style={{ color: colors.ink, fontSize: 22, fontFamily: fonts.display }}>
          Kernel<Text style={{ color: colors.gold }}>.</Text>
        </Text>
        {!last && (
          <Pressable onPress={finish} hitSlop={10} accessibilityRole="button" style={{ padding: 8 }}>
            <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 14 }}>Atla</Text>
          </Pressable>
        )}
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 28, flexGrow: 1 }}>
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            backgroundColor: colors.goldBg,
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 22,
          }}
        >
          {page.icon === "sparkle" ? <Sparkle size={26} /> : <Icon name={page.icon} size={26} color={colors.gold} />}
        </View>
        <Text style={{ color: colors.gold, fontFamily: fonts.uiBold, fontSize: 12, letterSpacing: 1.2 }}>
          {page.kicker.toLocaleUpperCase("tr")}
        </Text>
        <Text style={{ color: colors.ink, fontFamily: fonts.display, fontSize: 30, lineHeight: 36, marginTop: 8 }}>
          {page.title[0]}
          <Accent>{page.title[1]}</Accent>
        </Text>
        <View style={{ gap: 12, marginTop: 22 }}>
          {page.points.map((p) => (
            <View
              key={p}
              style={{
                flexDirection: "row",
                gap: 12,
                backgroundColor: colors.bg2,
                borderColor: colors.line,
                borderWidth: 1,
                borderRadius: radius.md,
                padding: 14,
              }}
            >
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.gold, marginTop: 8 }} />
              <Text style={{ color: colors.ink, fontSize: 15, lineHeight: 22, flex: 1 }}>{p}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={{ padding: 20, gap: 14 }}>
        <View style={{ flexDirection: "row", justifyContent: "center", gap: 8 }}>
          {PAGES.map((_, k) => (
            <View
              key={k}
              style={{
                width: k === i ? 22 : 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: k === i ? colors.gold : colors.line2,
              }}
            />
          ))}
        </View>
        {last ? (
          <>
            {demo && <DemoButtons />}
            <Btn title="Giriş yap" variant={demo ? "ghost" : "gold"} onPress={finish} />
          </>
        ) : (
          <View style={{ flexDirection: "row", gap: 10 }}>
            {i > 0 && (
              <View style={{ flex: 1 }}>
                <Btn title="Geri" variant="ghost" onPress={() => setI(i - 1)} />
              </View>
            )}
            <View style={{ flex: 2 }}>
              <Btn title="Devam" icon="arrow-right" variant="gold" onPress={() => setI(i + 1)} />
            </View>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}
