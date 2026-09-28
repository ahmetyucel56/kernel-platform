import { useEffect, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api, ApiError, type CommunityOut, type PostOut } from "../../src/api";
import { useAuth } from "../../src/auth";
import { canModerate } from "../../src/perm";
import { VoteButton } from "../../src/VoteButton";
import { BackHeader, Btn, Card, Loader, Muted, Screen, form } from "../../src/ui";
import { colors, radius } from "../../src/theme";

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString("tr-TR", { day: "2-digit", month: "short" });
}

export default function CommunityDetail() {
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const [community, setCommunity] = useState<CommunityOut | null>(null);
  const [posts, setPosts] = useState<PostOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sort, setSort] = useState<"new" | "top">("new");

  function loadPosts() {
    api<PostOut[]>(`/communities/${id}/posts?sort=${sort}`).then(setPosts).catch(() => {});
  }
  useEffect(() => {
    if (!id) return;
    api<CommunityOut>(`/communities/${id}`).then(setCommunity).catch(() => {});
  }, [id]);
  useEffect(() => {
    if (!id) return;
    api<PostOut[]>(`/communities/${id}/posts?sort=${sort}`)
      .then(setPosts)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id, sort]);

  async function createPost() {
    const t = title.trim();
    if (!t || posting) return;
    setErr(null);
    setPosting(true);
    try {
      await api(`/communities/${id}/posts`, {
        method: "POST",
        body: { title: t, body: body.trim() || null },
      });
      setTitle("");
      setBody("");
      loadPosts();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Gönderilemedi.");
    } finally {
      setPosting(false);
    }
  }

  function removeCommunity() {
    Alert.alert("Topluluğu sil", `"${community?.name ?? "Topluluk"}" ve tüm gönderileri silinsin mi?`, [
      { text: "Vazgeç", style: "cancel" },
      {
        text: "Sil",
        style: "destructive",
        onPress: async () => {
          try {
            await api(`/communities/${id}`, { method: "DELETE" });
            router.back();
          } catch (e) {
            Alert.alert("Hata", e instanceof ApiError ? e.message : "Silinemedi.");
          }
        },
      },
    ]);
  }

  function removePost(p: PostOut) {
    Alert.alert("Gönderiyi sil", `"${p.title}" silinsin mi?`, [
      { text: "Vazgeç", style: "cancel" },
      {
        text: "Sil",
        style: "destructive",
        onPress: async () => {
          try {
            await api(`/posts/${p.id}`, { method: "DELETE" });
            loadPosts();
          } catch (e) {
            Alert.alert("Hata", e instanceof ApiError ? e.message : "Silinemedi.");
          }
        },
      },
    ]);
  }

  if (loading) return <Loader />;

  return (
    <Screen>
      <BackHeader />

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <Text style={{ color: colors.ink, fontSize: 24, fontWeight: "800", flex: 1 }}>
          {community?.name ?? "Topluluk"}
        </Text>
        {community && canModerate(user, community.created_by) && (
          <Pressable onPress={removeCommunity} hitSlop={8}>
            <Text style={{ color: colors.danger, fontSize: 13 }}>Sil</Text>
          </Pressable>
        )}
      </View>

      <Card>
        <Text style={{ color: colors.ink, fontSize: 15, fontWeight: "700", marginBottom: 10 }}>
          Yeni gönderi
        </Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Başlık"
          placeholderTextColor={colors.faint}
          style={form.input}
        />
        <TextInput
          value={body}
          onChangeText={setBody}
          placeholder="Açıklama (opsiyonel)"
          placeholderTextColor={colors.faint}
          multiline
          style={[form.input, { marginTop: 10, minHeight: 70, textAlignVertical: "top" }]}
        />
        <View style={{ marginTop: 10 }}>
          <Btn
            title={posting ? "Gönderiliyor…" : "Gönder"}
            variant="gold"
            onPress={createPost}
            disabled={posting || !title.trim()}
          />
        </View>
        {err && <Text style={{ color: colors.danger, fontSize: 13, marginTop: 8 }}>{err}</Text>}
      </Card>

      <View style={{ flexDirection: "row", gap: 6, marginTop: 6, marginBottom: 10 }}>
        {(["new", "top"] as const).map((k) => {
          const on = sort === k;
          return (
            <Pressable
              key={k}
              onPress={() => setSort(k)}
              style={{
                paddingVertical: 6,
                paddingHorizontal: 14,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: on ? colors.gold : colors.line2,
                backgroundColor: on ? colors.gold : "transparent",
              }}
            >
              <Text style={{ color: on ? colors.onGold : colors.muted, fontSize: 13, fontWeight: on ? "800" : "500" }}>
                {k === "new" ? "Yeni" : "Popüler"}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View>
        {posts.length === 0 ? (
          <Card>
            <Muted>Henüz gönderi yok. İlk soruyu sen sor.</Muted>
          </Card>
        ) : (
          posts.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => router.push({ pathname: "/post/[id]", params: { id: p.id } })}
            >
              <Card>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                  <Text style={{ color: colors.ink, fontSize: 16, fontWeight: "700", flex: 1 }}>{p.title}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <VoteButton postId={p.id} votes={p.vote_count ?? 0} voted={!!p.i_voted} />
                    {canModerate(user, p.author_id) && (
                      <Pressable onPress={() => removePost(p)} hitSlop={8}>
                        <Text style={{ color: colors.danger, fontSize: 12.5 }}>Sil</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
                {p.body ? (
                  <Text style={{ color: colors.muted, fontSize: 14, marginTop: 4 }} numberOfLines={2}>
                    {p.body}
                  </Text>
                ) : null}
                <Muted style={{ fontSize: 12, marginTop: 8 }}>
                  {p.author_name ?? "Kullanıcı"} · {fmt(p.created_at)}
                  {p.edited_at ? " (düzenlendi)" : ""} · {p.reply_count ?? 0} yanıt
                </Muted>
              </Card>
            </Pressable>
          ))
        )}
      </View>
    </Screen>
  );
}

