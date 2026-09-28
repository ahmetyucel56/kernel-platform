import { useState, type ComponentProps, type ReactNode } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Feather from "@expo/vector-icons/Feather";
import Ionicons from "@expo/vector-icons/Ionicons";
import { colors, fonts, radius } from "./theme";

// Stiller her çizimde okunur: tema değişince (colors) yeni değerler geçerli olur.
const s = () => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 18, paddingBottom: 40 },
  card: {
    backgroundColor: colors.bg2,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 16,
    marginBottom: 14,
  },
  h1: { color: colors.ink, fontSize: 27, fontFamily: fonts.display, marginBottom: 4 },
  muted: { color: colors.muted, fontSize: 14 },
  tag: {
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 10,
    alignSelf: "flex-start" as const,
  },
  btn: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingVertical: 12,
    paddingHorizontal: 18,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    flexDirection: "row" as const,
    gap: 7,
    minHeight: 44,
  },
  label: { color: colors.muted, fontSize: 13, fontWeight: "500" as const, marginBottom: 6 },
  input: {
    color: colors.ink,
    backgroundColor: colors.bg,
    borderColor: colors.line2,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
  },
});

/** Form alanı stilleri (getter: her okunuşta güncel tema renkleri). */
export const form = {
  get label() {
    return s().label;
  },
  get input() {
    return s().input;
  },
};

export type IconName =ComponentProps<typeof Feather>["name"];

/** Çizgi ikon (Feather) — web'deki ikon setiyle aynı görünüm. */
export function Icon({ name, size = 18, color = colors.ink }: { name: IconName; size?: number; color?: string }) {
  return <Feather name={name} size={size} color={color} />;
}

/** AI işareti (web'deki yıldız ikonunun karşılığı). */
export function Sparkle({ size = 15, color = colors.gold }: { size?: number; color?: string }) {
  return <Ionicons name="sparkles-outline" size={size} color={color} />;
}

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const st = s();
  return (
    <SafeAreaView style={st.screen} edges={["top", "left", "right"]}>
      {scroll ? (
        <ScrollView contentContainerStyle={st.scroll} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={st.scroll}>{children}</View>
      )}
    </SafeAreaView>
  );
}

/** Ekran başlığı: geri oku + başlık/alt başlık + sağda isteğe bağlı eylem. */
export function BackHeader({
  title,
  subtitle,
  right,
}: {
  title?: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  const router = useRouter();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginLeft: -10, marginBottom: 12 }}>
      <Pressable
        onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)"))}
        accessibilityRole="button"
        accessibilityLabel="Geri"
        hitSlop={6}
        style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
      >
        <Icon name="chevron-left" size={24} />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        {title ? (
          <Text style={{ color: colors.ink, fontSize: 16, fontFamily: fonts.ui }} numberOfLines={1}>
            {title}
          </Text>
        ) : null}
        {subtitle ? (
          <Text style={{ color: colors.muted, fontSize: 12.5 }} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

/** Kare ikon düğmesi (bildirim, indir, menü…). */
export function IconButton({
  name,
  onPress,
  label,
  badge,
  color,
}: {
  name: IconName;
  onPress: () => void;
  label: string;
  badge?: number;
  color?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      style={{
        width: 44,
        height: 44,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.line2,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon name={name} size={19} color={color} />
      {badge ? (
        <View
          style={{
            position: "absolute",
            top: 5,
            right: 5,
            minWidth: 16,
            height: 16,
            paddingHorizontal: 4,
            borderRadius: 8,
            backgroundColor: colors.gold,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: colors.onGold, fontSize: 9.5, fontWeight: "800" }}>{badge > 9 ? "9+" : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[s().card, style]}>{children}</View>;
}

export function H1({ children }: { children: ReactNode }) {
  return <Text style={s().h1}>{children}</Text>;
}

/** Vurgulu italik (web'deki .accent): "Hoş geldin, <Accent>Mehmet.</Accent>" */
export function Accent({ children }: { children: ReactNode }) {
  return <Text style={{ color: colors.gold, fontFamily: fonts.accent }}>{children}</Text>;
}

export function Muted({ children, style }: { children: ReactNode; style?: object }) {
  return <Text style={[s().muted, style]}>{children}</Text>;
}

export function SectionLabel({ children, right, style }: { children: ReactNode; right?: ReactNode; style?: ViewStyle }) {
  return (
    <View
      style={[
        { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 22, marginBottom: 10 },
        style,
      ]}
    >
      <Text style={{ color: colors.muted, fontSize: 11.5, fontFamily: fonts.ui, letterSpacing: 1 }}>
        {/* textTransform Türkçe bilmez ("i" → "I"); metni tr kurallarıyla büyüt */}
        {typeof children === "string" ? children.toLocaleUpperCase("tr-TR") : children}
      </Text>
      {right}
    </View>
  );
}

export function Tag({ text, color = colors.muted, bg }: { text: string; color?: string; bg?: string }) {
  return (
    <View style={[s().tag, { borderColor: color, backgroundColor: bg ?? "transparent" }]}>
      <Text style={{ color, fontSize: 12, fontWeight: "600" }}>{text}</Text>
    </View>
  );
}

/** Durum etiketi (web'deki .chip varyantları). */
export function Chip({ text, kind = "muted" }: { text: string; kind?: "muted" | "gold" | "blue" | "ok" | "danger" }) {
  const map = {
    muted: [colors.muted, "transparent"],
    gold: [colors.gold, colors.goldBg],
    blue: [colors.blueSoft, colors.blueBg],
    ok: [colors.ok, colors.okBg],
    danger: [colors.danger, colors.dangerBg],
  } as const;
  const [fg, bg] = map[kind];
  return <Tag text={text} color={fg} bg={bg} />;
}

/** Altın çerçeveli "AI" butonu (sınıf/öğrenci satırlarında AI özetini açar). */
export function AiChip({ onPress, label = "AI" }: { onPress: () => void; label?: string }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={`${label} özeti`}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        borderWidth: 1,
        borderColor: colors.goldDim,
        backgroundColor: colors.goldBg,
        borderRadius: 999,
        paddingVertical: 5,
        paddingHorizontal: 10,
      }}
    >
      <Sparkle size={13} />
      <Text style={{ color: colors.gold, fontSize: 12, fontFamily: fonts.ui }}>{label}</Text>
    </Pressable>
  );
}

export function Btn({
  title,
  onPress,
  variant = "primary",
  disabled,
  icon,
  small,
}: {
  title: string;
  onPress?: () => void;
  variant?: "primary" | "gold" | "ghost" | "danger";
  disabled?: boolean;
  icon?: IconName | "sparkle";
  small?: boolean;
}) {
  const bg = variant === "primary" ? colors.blue : variant === "gold" ? colors.gold : "transparent";
  const fg =
    variant === "gold" ? colors.onGold : variant === "ghost" ? colors.ink : variant === "danger" ? colors.danger : "#fff";
  const border = variant === "ghost" || variant === "danger" ? colors.line2 : bg;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={[
        s().btn,
        { backgroundColor: bg, opacity: disabled ? 0.5 : 1, borderColor: border },
        small ? { minHeight: 36, paddingVertical: 7, paddingHorizontal: 13 } : null,
      ]}
    >
      {icon === "sparkle" ? <Sparkle size={15} color={fg} /> : icon ? <Icon name={icon} size={16} color={fg} /> : null}
      <Text style={{ color: fg, fontFamily: fonts.ui, fontSize: small ? 13 : 14 }}>{title}</Text>
    </Pressable>
  );
}

export function Field({ label, ...props }: { label: string } & TextInputProps) {
  const st = s();
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={st.label}>{label}</Text>
      <TextInput placeholderTextColor={colors.faint} style={st.input} {...props} />
    </View>
  );
}

export function ProgressBar({ pct, done }: { pct: number; done?: boolean }) {
  return (
    <View style={{ height: 5, borderRadius: 3, backgroundColor: colors.line, overflow: "hidden" }}>
      <View
        style={{
          width: `${Math.max(0, Math.min(100, pct))}%`,
          height: 5,
          borderRadius: 3,
          backgroundColor: done ? colors.ok : colors.blueSoft,
        }}
      />
    </View>
  );
}

/** "İlgilenmen gerekenler" kutusu. */
export function StatTile({
  label,
  value,
  sub,
  warn,
  onPress,
}: {
  label: string;
  value: number;
  sub: string;
  warn?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={{
        flex: 1,
        backgroundColor: warn ? colors.dangerBg : colors.bg2,
        borderColor: warn ? colors.danger : colors.line,
        borderWidth: 1,
        borderRadius: radius.md,
        padding: 12,
        minWidth: 0,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        {warn ? <Icon name="alert-triangle" size={12} color={colors.danger} /> : null}
        <Text style={{ color: warn ? colors.danger : colors.muted, fontSize: 11.5, fontFamily: fonts.ui }} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Text style={{ color: value ? colors.ink : colors.muted, fontSize: 27, fontFamily: fonts.display, marginTop: 2 }}>
        {value}
      </Text>
      <Text style={{ color: colors.muted, fontSize: 11.5 }} numberOfLines={1}>
        {sub}
      </Text>
    </Pressable>
  );
}

/** Bölüm seçici (web'deki sekmelerin karşılığı). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: "row",
        backgroundColor: colors.bg2,
        borderColor: colors.line,
        borderWidth: 1,
        borderRadius: 12,
        padding: 4,
        marginBottom: 14,
      }}
    >
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.key)}
            style={{
              flex: 1,
              minHeight: 36,
              borderRadius: 9,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: on ? colors.bg3 : "transparent",
            }}
          >
            <Text style={{ color: on ? colors.ink : colors.muted, fontSize: 13, fontFamily: fonts.ui }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Açılır seçim (modal). Üniversite gibi listelerden seçim için. */
export function Select({
  label,
  value,
  options,
  onChange,
  placeholder = "Seç…",
  loading = false,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  placeholder?: string;
  loading?: boolean;
}) {
  const st = s();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const norm = (t: string) => t.toLocaleLowerCase("tr").replace(/i̇/g, "i");
  const filtered = q.trim() ? options.filter((o) => norm(o).includes(norm(q.trim()))) : options;

  function close() {
    setOpen(false);
    setQ("");
  }

  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={st.label}>{label}</Text>
      <Pressable style={[st.input, { flexDirection: "row", alignItems: "center" }]} onPress={() => !loading && setOpen(true)}>
        <Text style={{ color: value ? colors.ink : colors.faint, fontSize: 15, flex: 1 }} numberOfLines={1}>
          {loading ? "Yükleniyor…" : value || placeholder}
        </Text>
        <Icon name="chevron-down" size={16} color={colors.muted} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <Pressable style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: "center", padding: 22 }} onPress={close}>
          <Pressable
            style={{
              backgroundColor: colors.bg2,
              borderColor: colors.line,
              borderWidth: 1,
              borderRadius: radius.md,
              padding: 14,
            }}
            onPress={() => {}}
          >
            <Text style={[st.label, { fontSize: 14, marginBottom: 10 }]}>{label}</Text>
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Ara…"
              placeholderTextColor={colors.faint}
              autoCorrect={false}
              style={[st.input, { marginBottom: 10 }]}
            />
            <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled">
              {filtered.length === 0 ? (
                <Text style={{ color: colors.faint, padding: 12, fontSize: 14 }}>Sonuç yok.</Text>
              ) : (
                filtered.map((opt) => {
                  const active = opt === value;
                  return (
                    <Pressable
                      key={opt}
                      style={{ paddingVertical: 12, paddingHorizontal: 12, borderRadius: radius.sm, backgroundColor: active ? colors.bg3 : "transparent" }}
                      onPress={() => {
                        onChange(opt);
                        close();
                      }}
                    >
                      <Text style={{ color: active ? colors.gold : colors.ink, fontSize: 15, fontWeight: active ? "700" : "400" }}>
                        {opt}
                      </Text>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

export function Loader() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center", alignItems: "center" }}>
      <ActivityIndicator color={colors.gold} />
    </View>
  );
}
