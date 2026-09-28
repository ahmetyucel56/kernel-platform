import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { colors, radius } from "./theme";

/** Web'deki datetime-local karşılığı: takvimden gün + saat seçimi.
 *  Ek yerel modül gerektirmez (Expo Go ve web önizlemede aynı çalışır). */

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const DAYS = ["Pt", "Sa", "Ça", "Pe", "Cu", "Ct", "Pz"];
const MINUTES = [0, 15, 30, 45, 59];
const CELL = `${100 / 7}%` as `${number}%`;

const pad = (n: number) => String(n).padStart(2, "0");
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function label(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function DateTimeField({
  label: title,
  value,
  onChange,
  presets = [],
}: {
  label: string;
  value: Date;
  onChange: (d: Date) => void;
  /** Hızlı seçim: bugünden N gün sonra 23:59 */
  presets?: { days: number; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => new Date(value.getFullYear(), value.getMonth(), 1));
  const today = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);

  // Pazartesi başlangıçlı ay ızgarası
  const cells = useMemo(() => {
    const first = new Date(month);
    const lead = (first.getDay() + 6) % 7;
    const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const out: (Date | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= count; d++) out.push(new Date(month.getFullYear(), month.getMonth(), d));
    while (out.length % 7) out.push(null);
    return out;
  }, [month]);

  function setDay(day: Date) {
    const d = new Date(value);
    d.setFullYear(day.getFullYear(), day.getMonth(), day.getDate());
    onChange(d);
  }
  function setTime(h: number, m: number) {
    const d = new Date(value);
    d.setHours((h + 24) % 24, m, 0, 0);
    onChange(d);
  }
  function preset(days: number) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(23, 59, 0, 0);
    setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
    onChange(d);
  }

  return (
    <View style={{ marginTop: 14 }}>
      <Text style={{ color: colors.muted, fontSize: 13, fontWeight: "500", marginBottom: 6 }}>{title}</Text>
      {presets.length > 0 && (
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          {presets.map((p) => (
            <Chip key={p.days} text={p.label} onPress={() => preset(p.days)} />
          ))}
        </View>
      )}
      <Pressable
        onPress={() => setOpen((o) => !o)}
        style={{
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: colors.bg,
          borderColor: open ? colors.gold : colors.line2,
          borderWidth: 1,
          borderRadius: radius.sm,
          paddingHorizontal: 12,
          paddingVertical: 11,
        }}
      >
        <Text style={{ color: colors.ink, fontSize: 15, flex: 1 }}>📅 {label(value)}</Text>
        <Text style={{ color: colors.blueSoft, fontSize: 13 }}>{open ? "Tamam" : "Değiştir"}</Text>
      </Pressable>

      {open && (
        <View
          style={{
            marginTop: 8,
            backgroundColor: colors.bg3,
            borderColor: colors.line,
            borderWidth: 1,
            borderRadius: radius.sm,
            padding: 12,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Pressable hitSlop={10} onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
              <Text style={{ color: colors.ink, fontSize: 18, paddingHorizontal: 8 }}>‹</Text>
            </Pressable>
            <Text style={{ color: colors.ink, fontSize: 14.5, fontWeight: "700" }}>
              {MONTHS[month.getMonth()]} {month.getFullYear()}
            </Text>
            <Pressable hitSlop={10} onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
              <Text style={{ color: colors.ink, fontSize: 18, paddingHorizontal: 8 }}>›</Text>
            </Pressable>
          </View>

          <View style={{ flexDirection: "row", marginTop: 10 }}>
            {DAYS.map((d) => (
              <Text key={d} style={{ flex: 1, textAlign: "center", color: colors.faint, fontSize: 11.5 }}>
                {d}
              </Text>
            ))}
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 4 }}>
            {cells.map((day, i) => {
              if (!day) return <View key={i} style={{ width: CELL, height: 36 }} />;
              const selected = sameDay(day, value);
              const past = day < today;
              return (
                <Pressable
                  key={i}
                  disabled={past}
                  onPress={() => setDay(day)}
                  style={{ width: CELL, height: 36, alignItems: "center", justifyContent: "center" }}
                >
                  <View
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 16,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: selected ? colors.gold : "transparent",
                      borderWidth: sameDay(day, today) && !selected ? 1 : 0,
                      borderColor: colors.line2,
                    }}
                  >
                    <Text
                      style={{
                        color: selected ? colors.onGold : past ? colors.faint : colors.ink,
                        opacity: past ? 0.45 : 1,
                        fontSize: 13.5,
                        fontWeight: selected ? "800" : "500",
                      }}
                    >
                      {day.getDate()}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          {/* Saat: ± ile saat, hazır dakika seçenekleri */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
            <Text style={{ color: colors.muted, fontSize: 13 }}>Saat</Text>
            <Chip text="−" onPress={() => setTime(value.getHours() - 1, value.getMinutes())} />
            <Text style={{ color: colors.ink, fontSize: 16, fontWeight: "700", minWidth: 26, textAlign: "center" }}>
              {pad(value.getHours())}
            </Text>
            <Chip text="+" onPress={() => setTime(value.getHours() + 1, value.getMinutes())} />
            <Text style={{ color: colors.muted, fontSize: 13, marginLeft: 6 }}>Dakika</Text>
            {MINUTES.map((m) => (
              <Chip
                key={m}
                text={pad(m)}
                active={value.getMinutes() === m}
                onPress={() => setTime(value.getHours(), m)}
              />
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

function Chip({ text, onPress, active }: { text: string; onPress: () => void; active?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      style={{
        paddingVertical: 7,
        paddingHorizontal: 12,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? colors.gold : colors.line2,
        backgroundColor: active ? colors.goldBg : "transparent",
      }}
    >
      <Text style={{ color: active ? colors.gold : colors.ink, fontSize: 13, fontWeight: "600" }}>{text}</Text>
    </Pressable>
  );
}
