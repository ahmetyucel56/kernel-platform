import { Switch, Text, View } from "react-native";
import { colors, radius } from "./theme";

export type Visibility = { requirement: boolean; cleanCode: boolean };

/** Hocanın başlattığı AI sonuçlarını öğrenci görsün mü (web'deki StudentVisibility ile aynı). */
export function StudentVisibility({ value, onChange }: { value: Visibility; onChange: (v: Visibility) => void }) {
  const row = (label: string, on: boolean, set: (v: boolean) => void) => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 }}>
      <Text style={{ color: colors.ink, fontSize: 14, flex: 1 }}>{label}</Text>
      <Switch
        value={on}
        onValueChange={set}
        trackColor={{ true: colors.goldDim, false: colors.line2 }}
        thumbColor={on ? colors.gold : colors.muted}
        accessibilityLabel={label}
      />
    </View>
  );
  return (
    <View style={{ backgroundColor: colors.bg3, borderRadius: radius.sm, padding: 12, marginTop: 14 }}>
      <Text style={{ color: colors.ink, fontSize: 14, fontWeight: "600" }}>
        Öğrenci, başlattığın AI analizlerinin sonucunu görsün
      </Text>
      <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
        Kapalıysa sonucu yalnızca sen görürsün; gelişim grafiği ve rozetler de etkilenmez. "Eksikleri gönder"
        ile ilettiklerin her durumda ulaşır.
      </Text>
      {row("Gereksinim kontrolü sonucu", value.requirement, (v) => onChange({ ...value, requirement: v }))}
      {row("Clean Code sonucu", value.cleanCode, (v) => onChange({ ...value, cleanCode: v }))}
    </View>
  );
}
