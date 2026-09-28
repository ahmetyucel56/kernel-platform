import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { api, ApiError, type ClassOut, type Course } from "./api";
import { Btn, form, Select } from "./ui";
import { colors, radius } from "./theme";

const NEW = "+ Sınıfa yeni ders ekle…";

/** Ödevin dersi (web'deki CoursePicker ile aynı): sınıfın derslerinden seçilir; yoksa buradan eklenir. */
export function CoursePicker({
  classId,
  courses,
  value,
  onChange,
  onClassChanged,
}: {
  classId: string;
  courses: Course[];
  value: string;
  onChange: (id: string) => void;
  onClassChanged: (c: ClassOut) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const showInput = adding || courses.length === 0;

  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const cls = await api<ClassOut>(`/classes/${classId}/courses`, { method: "POST", body: { name: name.trim() } });
      onClassChanged(cls);
      const created = cls.courses.find((c) => c.name.toLocaleLowerCase("tr") === name.trim().toLocaleLowerCase("tr"));
      if (created) onChange(created.id);
      setName("");
      setAdding(false);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Ders eklenemedi.");
    } finally {
      setBusy(false);
    }
  }

  if (!showInput) {
    return (
      <Select
        label="Ders"
        value={courses.find((c) => c.id === value)?.name ?? ""}
        options={[...courses.map((c) => c.name), NEW]}
        onChange={(v) => {
          if (v === NEW) return setAdding(true);
          const c = courses.find((x) => x.name === v);
          if (c) onChange(c.id);
        }}
        placeholder="Hangi ders? Seç…"
      />
    );
  }

  return (
    <View style={{ backgroundColor: colors.bg3, borderRadius: radius.sm, padding: 12, marginBottom: 14 }}>
      <Text style={form.label}>Ders</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Mesleki Çözümleme I"
          placeholderTextColor={colors.faint}
          style={[form.input, { flex: 1 }]}
          onSubmitEditing={add}
        />
        <Btn title={busy ? "…" : "Ekle"} variant="primary" onPress={add} disabled={busy || !name.trim()} />
      </View>
      <Text style={{ color: colors.faint, fontSize: 12, marginTop: 6 }}>
        {courses.length === 0
          ? "Bu sınıfta henüz ders yok. Bu ödevin dersini yaz; ders sınıfa eklenir."
          : "Ders sınıfa eklenir, sonraki ödevlerde de seçebilirsin."}
      </Text>
      {courses.length > 0 && (
        <Text onPress={() => setAdding(false)} style={{ color: colors.blueSoft, fontSize: 13, marginTop: 8 }}>
          Vazgeç, listeden seç
        </Text>
      )}
      {err && <Text style={{ color: colors.danger, fontSize: 13, marginTop: 6 }}>{err}</Text>}
    </View>
  );
}
