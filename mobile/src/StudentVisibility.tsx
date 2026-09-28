import { Switch, Text, View } from "react-native";
import { colors, radius } from "./theme";
import { Segmented } from "./ui";

export type Visibility = { requirement: boolean; cleanCode: boolean };

/** Hocanın başlattığı AI sonuçlarını öğrenci görsün mü (web'deki StudentVisibility ile aynı). */
export type SubmissionKind = "code" | "document";

/** Ödevin teslim türü: kod projesi ya da rapor/belge (web'deki SubmissionKindPicker ile aynı). */
export function SubmissionKindPicker({ value, onChange }: { value: SubmissionKind; onChange: (v: SubmissionKind) => void }) {
  return (
    <View style={{ marginTop: 14 }}>
      <Text style={{ color: colors.ink, fontSize: 14, fontWeight: "600", marginBottom: 8 }}>Teslim türü</Text>
      <Segmented<SubmissionKind>
        options={[{ key: "code", label: "Kod projesi" }, { key: "document", label: "Rapor / belge" }]}
        value={value}
        onChange={onChange}
      />
      <Text style={{ color: colors.muted, fontSize: 12, marginTop: -6 }}>
        {value === "code"
          ? "Öğrenci dosyalarını ya da ZIP yükler. Kod kalitesi ve gereksinim kontrolü yapılabilir."
          : "Öğrenci PDF, DOCX, görsel (PNG/JPG) ya da TXT yükler; indirmeden önizlenir. Yapay zekâ gereksinimleri belgenin metninde kontrol eder."}
      </Text>
    </View>
  );
}

export function StudentVisibility({
  value,
  onChange,
  document = false,
}: {
  value: Visibility;
  onChange: (v: Visibility) => void;
  document?: boolean;
}) {
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
      {!document && row("Clean Code sonucu", value.cleanCode, (v) => onChange({ ...value, cleanCode: v }))}
    </View>
  );
}
