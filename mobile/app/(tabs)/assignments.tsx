import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import {
  api,
  ApiError,
  DOCUMENT_MIME,
  uploadSubmission,
  type Assignment,
  type ClassOut,
  type SubmissionListItem,
} from "../../src/api";
import { useAuth } from "../../src/auth";
import { Btn, Card, H1, Loader, Muted, Screen, Tag } from "../../src/ui";
import { colors } from "../../src/theme";
import { PrecheckCard } from "../../src/PrecheckCard";
import { dueLabel, dueOf, isPast } from "../../src/format";

export default function Assignments() {
  const { user } = useAuth();
  const router = useRouter();
  const isAcademician = user?.role === "academician" || user?.role === "admin";
  const [items, setItems] = useState<{ cls: ClassOut; list: Assignment[] }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const classes = await api<ClassOut[]>("/classes");
        const withA = await Promise.all(
          classes.map(async (cls) => ({
            cls,
            list: await api<Assignment[]>(`/assignments?class_id=${cls.id}`),
          }))
        );
        setItems(withA);
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <Loader />;

  const noClasses = items.length === 0;

  return (
    <Screen>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <H1>Ödevlerim</H1>
        {isAcademician && !noClasses && (
          <Btn title="+ Yeni" variant="gold" onPress={() => router.push("/assignment/new")} />
        )}
      </View>
      <Muted style={{ marginBottom: 10 }}>
        {isAcademician ? "Verdiğin ödevler ve gönderim takibi." : "Ödevlerini yükle ve geri bildirimini gör."}
      </Muted>

      {noClasses && (
        <Card>
          <Muted>
            {isAcademician
              ? "Henüz sınıfın yok. Panom sekmesindeki \"+ Sınıf\" ile oluşturabilirsin; sonra buradan ödev verebilirsin."
              : "Kayıtlı olduğun sınıf yok."}
          </Muted>
        </Card>
      )}

      {items.map(({ cls, list }) => (
        <View key={cls.id} style={{ marginTop: 8 }}>
          <Muted style={{ marginBottom: 8 }}>{cls.name}</Muted>
          {list.length === 0 ? (
            <Card>
              <Muted>Bu sınıfta ödev yok.</Muted>
            </Card>
          ) : isAcademician ? (
            list.map((a) => <AcademicianCard key={a.id} a={a} />)
          ) : (
            list.map((a) => <AssignmentCard key={a.id} a={a} />)
          )}
        </View>
      ))}

      {!isAcademician && !noClasses && (
        <Muted style={{ fontSize: 12, marginTop: 6 }}>
          Dosyalarını (birden fazla seçebilirsin) ya da .zip'ini yükle; her teslim yeni bir sürüm olur.
        </Muted>
      )}
    </Screen>
  );
}

/** Akademisyen: ödev kartı → gönderim takibine götürür. */
function AcademicianCard({ a }: { a: Assignment }) {
  const router = useRouter();
  const [count, setCount] = useState<number | null>(null);
  const past = isPast(dueOf(a));

  useEffect(() => {
    api<SubmissionListItem[]>(`/assignments/${a.id}/submissions`)
      .then((subs) => setCount(new Set(subs.map((s) => s.student_id)).size))
      .catch(() => setCount(null));
  }, [a.id]);

  return (
    <Pressable onPress={() => router.push({ pathname: "/assignment/[id]", params: { id: a.id } })}>
      <Card>
        {a.course_name ? (
          <View style={{ flexDirection: "row", marginBottom: 6 }}>
            <Tag text={a.course_name} color={colors.gold} />
          </View>
        ) : null}
        <View style={{ flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap" }}>
          <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "700", flex: 1 }}>{a.title}</Text>
          <Tag text={past ? "Süre doldu" : "Açık"} color={past ? colors.muted : colors.gold} />
        </View>
        <Muted style={{ marginTop: 6, fontSize: 13 }}>Teslim: {dueLabel(a)}</Muted>
      {a.submission_kind === "document" && (
        <Muted style={{ marginTop: 2, fontSize: 12 }}>Rapor / belge ödevi: PDF, DOCX, görsel ya da TXT yükle.</Muted>
      )}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
          <Muted style={{ fontSize: 13 }}>
            {count === null ? "Gönderimler…" : `${count} öğrenci teslim etti`}
          </Muted>
          <Text style={{ color: colors.blueSoft, fontSize: 13 }}>Gönderimleri gör →</Text>
        </View>
      </Card>
    </Pressable>
  );
}

/** Öğrenci: ödev kartı → yükleme + kendi sürümleri. */
function AssignmentCard({ a }: { a: Assignment }) {
  const [subs, setSubs] = useState<SubmissionListItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const router = useRouter();
  const past = isPast(dueOf(a)); // hoca uzattıysa yükleme yeniden açılır

  function loadSubs() {
    api<SubmissionListItem[]>(`/assignments/${a.id}/submissions`).then(setSubs).catch(() => {});
  }
  useEffect(loadSubs, [a.id]);

  async function pickAndUpload() {
    setMsg(null);
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: a.submission_kind === "document" ? DOCUMENT_MIME : "*/*",
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (res.canceled || !res.assets.length) return;
      setUploading(true);
      await uploadSubmission(
        a.id,
        res.assets.map((f) => ({ uri: f.uri, name: f.name, mimeType: f.mimeType, size: f.size }))
      );
      setMsg({ kind: "ok", text: "Yüklendi. Yeni sürüm oluşturuldu." });
      loadSubs();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof ApiError ? e.message : "Yükleme başarısız." });
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card>
      {a.course_name ? (
        <View style={{ flexDirection: "row", marginBottom: 6 }}>
          <Tag text={a.course_name} color={colors.gold} />
        </View>
      ) : null}
      <View style={{ flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap" }}>
        <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "700", flex: 1 }}>{a.title}</Text>
        <Tag text={past ? "Süre doldu" : "Açık"} color={past ? colors.muted : colors.gold} />
      </View>
      {a.description ? <Muted style={{ marginTop: 4 }}>{a.description}</Muted> : null}
      <Muted style={{ marginTop: 6, fontSize: 13 }}>Teslim: {dueLabel(a)}</Muted>
      {a.requirements_json && a.requirements_json.length > 0 && (
        <View style={{ marginTop: 8 }}>
          {a.requirements_json.map((r, i) => (
            <Text key={i} style={{ color: colors.muted, fontSize: 13 }}>
              • {r}
            </Text>
          ))}
        </View>
      )}

      <View style={{ marginTop: 12 }}>
        <Btn
          title={
            past
              ? "Teslim süresi doldu"
              : uploading
                ? "Yükleniyor…"
                : subs.length > 0
                  ? "Yeni sürüm yükle"
                  : "Ödev yükle"
          }
          onPress={pickAndUpload}
          variant="gold"
          disabled={uploading || past}
        />
        {msg && (
          <Text
            style={{
              color: msg.kind === "ok" ? colors.ok : colors.danger,
              fontSize: 13,
              marginTop: 8,
            }}
          >
            {msg.text}
          </Text>
        )}
      </View>

      {a.precheck_enabled && !past && <PrecheckCard assignmentId={a.id} document={a.submission_kind === "document"} />}

      {subs.length > 0 && (
        <View style={{ marginTop: 12 }}>
          <Muted style={{ fontSize: 12, marginBottom: 6 }}>Gönderimlerim — geri bildirim için dokun</Muted>
          {subs.map((s) => (
            <Pressable
              key={s.id}
              onPress={() => router.push({ pathname: "/submission/[id]", params: { id: s.id } })}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingVertical: 10,
                paddingHorizontal: 12,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: colors.line2,
                marginBottom: 8,
              }}
            >
              <Text style={{ color: colors.ink, fontSize: 14, fontWeight: "600" }}>
                Sürüm v{s.version_number}
              </Text>
              <Text style={{ color: colors.blueSoft, fontSize: 13 }}>Aç →</Text>
            </Pressable>
          ))}
        </View>
      )}
    </Card>
  );
}
