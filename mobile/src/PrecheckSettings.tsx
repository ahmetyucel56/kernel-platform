import { Pressable, Switch, Text, View } from "react-native";
import { colors, radius } from "./theme";

/** Akademisyen: öğrencinin teslim öncesi ön kontrol izni + 24 saatlik hak sayısı. */
export function PrecheckSettings({
  enabled,
  limit,
  onChange,
}: {
  enabled: boolean;
  limit: number;
  onChange: (enabled: boolean, limit: number) => void;
}) {
  const step = (d: number) => onChange(enabled, Math.max(1, Math.min(20, limit + d)));
  return (
    <View style={{ backgroundColor: colors.bg3, borderRadius: radius.sm, padding: 12, marginTop: 14 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.ink, fontSize: 14, fontWeight: "600" }}>
            Öğrenciler teslimden önce AI ön kontrolü yapabilsin
          </Text>
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
            Eksiklerini teslimden önce görürler. Teslim sayılmaz.
          </Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={(v) => onChange(v, limit)}
          trackColor={{ true: colors.goldDim, false: colors.line2 }}
          thumbColor={enabled ? colors.gold : colors.muted}
        />
      </View>
      {enabled && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 }}>
          <Text style={{ color: colors.muted, fontSize: 13 }}>Öğrenci başına 24 saatte</Text>
          <Pressable onPress={() => step(-1)} hitSlop={8} style={stepBtn()}>
            <Text style={{ color: colors.ink, fontSize: 16 }}>−</Text>
          </Pressable>
          <Text style={{ color: colors.gold, fontSize: 16, fontWeight: "800", minWidth: 20, textAlign: "center" }}>
            {limit}
          </Text>
          <Pressable onPress={() => step(1)} hitSlop={8} style={stepBtn()}>
            <Text style={{ color: colors.ink, fontSize: 16 }}>+</Text>
          </Pressable>
          <Text style={{ color: colors.muted, fontSize: 13 }}>hak</Text>
        </View>
      )}
    </View>
  );
}

const stepBtn = () => ({
  width: 30,
  height: 30,
  borderRadius: 15,
  borderWidth: 1,
  borderColor: colors.line2,
  alignItems: "center",
  justifyContent: "center",
}) as const;
