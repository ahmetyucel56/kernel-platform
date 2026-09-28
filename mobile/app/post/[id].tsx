import { useEffect, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api, ApiError, type PostOut, type ReplyOut } from "../../src/api";
import { useAuth } from "../../src/auth";
import { canModerate } from "../../src/perm";
import { VoteButton } from "../../src/VoteButton";
import { BackHeader, Btn, Card, Loader, Muted, Screen, form } from "../../src/ui";
import { colors, radius } from "../../src/theme";

function fmt(iso: string) {
  return new Date(iso).toLocaleString("tr-TR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function PostDetail() {
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const [post, setPost] = useState<PostOut | null>(null);
  const [replies, setReplies] = useState<ReplyOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Düzenleme (yalnızca yazar)
  const [editingPost, setEditingPost] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editingReply, setEditingReply] = useState<string | null>(null);
  const [editReplyBody, setEditReplyBody] = useState("");
  const [saving, setSaving] = useState(false);

  function startEditPost() {
    if (!post) return;
    setEditTitle(post.title);
    setEditBody(post.body ?? "");
    setEditingPost(true);
  }

  async function savePost() {
    if (!editTitle.trim() || saving) return;
    setSaving(true);
    try {
      const p = await api<PostOut>(`/posts/${id}`, {
        method: "PATCH",
        body: { title: editTitle.trim(), body: editBody.trim() || null },
      });
      setPost(p);
      setEditingPost(false);
    } catch (e) {
      Alert.alert("Hata", e instanceof ApiError ? e.message : "Kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }

  async function saveReply(rid: string) {
    if (!editReplyBody.trim() || saving) return;
    setSaving(true);
    try {
      await api(`/posts/${id}/replies/${rid}`, { method: "PATCH", body: { body: editReplyBody.trim() } });
      setEditingReply(null);
      loadReplies();
    } catch (e) {
      Alert.alert("Hata", e instanceof ApiError ? e.message : "Kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }

  function loadReplies() {
    api<ReplyOut[]>(`/posts/${id}/replies`).then(setReplies).catch(() => {});
  }
  useEffect(() => {
    if (!id) return;
    api<PostOut>(`/posts/${id}`).then(setPost).catch(() => setErr("Gönderi yüklenemedi."));
    api<ReplyOut[]>(`/posts/${id}/replies`)
      .then(setReplies)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  async function reply() {
    const b = body.trim();
    if (!b || sending) return;
    setErr(null);
    setSending(true);
    try {
      await api(`/posts/${id}/replies`, { method: "POST", body: { body: b } });
      setBody("");
      loadReplies();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Gönderilemedi.");
    } finally {
      setSending(false);
    }
  }

  function removePost() {
    Alert.alert("Gönderiyi sil", "Bu gönderi ve yanıtları silinsin mi?", [
      { text: "Vazgeç", style: "cancel" },
      {
        text: "Sil",
        style: "destructive",
        onPress: async () => {
          try {
            await api(`/posts/${id}`, { method: "DELETE" });
            router.back();
          } catch (e) {
            Alert.alert("Hata", e instanceof ApiError ? e.message : "Silinemedi.");
          }
        },
      },
    ]);
  }

  function removeReply(rid: string) {
    Alert.alert("Yanıtı sil", "Bu yanıt silinsin mi?", [
      { text: "Vazgeç", style: "cancel" },
      {
        text: "Sil",
        style: "destructive",
        onPress: async () => {
          try {
            await api(`/posts/${id}/replies/${rid}`, { method: "DELETE" });
            loadReplies();
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

      <Card>
        {editingPost ? (
          <>
            <TextInput value={editTitle} onChangeText={setEditTitle} placeholder="Başlık"
              placeholderTextColor={colors.faint} style={form.input} />
            <TextInput value={editBody} onChangeText={setEditBody} placeholder="Detay"
              placeholderTextColor={colors.faint} multiline
              style={[form.input, { marginTop: 10, minHeight: 80, textAlignVertical: "top" }]} />
            <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
              <Btn title={saving ? "…" : "Kaydet"} variant="primary" onPress={savePost}
                disabled={saving || !editTitle.trim()} />
              <Btn title="Vazgeç" variant="ghost" onPress={() => setEditingPost(false)} />
            </View>
          </>
        ) : (
          <>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
              <Text style={{ color: colors.ink, fontSize: 20, fontWeight: "800", flex: 1 }}>
                {post?.title ?? "Gönderi"}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                {post && (
                  <VoteButton postId={post.id} votes={post.vote_count ?? 0} voted={!!post.i_voted} />
                )}
                {post && user?.id === post.author_id && (
                  <Pressable onPress={startEditPost} hitSlop={8}>
                    <Text style={{ color: colors.blueSoft, fontSize: 13 }}>Düzenle</Text>
                  </Pressable>
                )}
                {post && canModerate(user, post.author_id) && (
                  <Pressable onPress={removePost} hitSlop={8}>
                    <Text style={{ color: colors.danger, fontSize: 13 }}>Sil</Text>
                  </Pressable>
                )}
              </View>
            </View>
            {post?.body ? (
              <Text style={{ color: colors.ink, fontSize: 14.5, marginTop: 8, lineHeight: 20 }}>
                {post.body}
              </Text>
            ) : null}
            {post && (
              <Muted style={{ fontSize: 12, marginTop: 10 }}>
                {post.author_name ?? "Kullanıcı"} · {fmt(post.created_at)}
                {post.edited_at ? " · düzenlendi" : ""}
              </Muted>
            )}
          </>
        )}
      </Card>

      <Text
        style={{
          color: colors.muted,
          fontSize: 12,
          fontWeight: "700",
          letterSpacing: 1,
          textTransform: "uppercase",
          marginTop: 20,
          marginBottom: 10,
        }}
      >
        Yanıtlar ({replies.length})
      </Text>

      {replies.length === 0 ? (
        <Card>
          <Muted>Henüz yanıt yok. İlk yanıtı sen yaz.</Muted>
        </Card>
      ) : (
        replies.map((r) => (
          <Card key={r.id}>
            {editingReply === r.id ? (
              <>
                <TextInput value={editReplyBody} onChangeText={setEditReplyBody} multiline
                  placeholderTextColor={colors.faint}
                  style={[form.input, { minHeight: 60, textAlignVertical: "top" }]} />
                <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                  <Btn title={saving ? "…" : "Kaydet"} variant="primary" onPress={() => saveReply(r.id)}
                    disabled={saving || !editReplyBody.trim()} />
                  <Btn title="Vazgeç" variant="ghost" onPress={() => setEditingReply(null)} />
                </View>
              </>
            ) : (
              <Text style={{ color: colors.ink, fontSize: 14.5, lineHeight: 20 }}>{r.body}</Text>
            )}
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
              <Muted style={{ fontSize: 12 }}>
                {r.author_name ?? "Kullanıcı"} · {fmt(r.created_at)}
                {r.edited_at ? " · düzenlendi" : ""}
              </Muted>
              <View style={{ flexDirection: "row", gap: 12 }}>
                {user?.id === r.author_id && editingReply !== r.id && (
                  <Pressable
                    onPress={() => {
                      setEditReplyBody(r.body);
                      setEditingReply(r.id);
                    }}
                    hitSlop={8}
                  >
                    <Text style={{ color: colors.blueSoft, fontSize: 12.5 }}>Düzenle</Text>
                  </Pressable>
                )}
                {canModerate(user, r.author_id) && (
                  <Pressable onPress={() => removeReply(r.id)} hitSlop={8}>
                    <Text style={{ color: colors.danger, fontSize: 12.5 }}>Sil</Text>
                  </Pressable>
                )}
              </View>
            </View>
          </Card>
        ))
      )}

      <Card style={{ marginTop: 8 }}>
        <TextInput
          value={body}
          onChangeText={setBody}
          placeholder="Yanıt yaz…"
          placeholderTextColor={colors.faint}
          multiline
          style={{
            color: colors.ink,
            backgroundColor: colors.bg,
            borderColor: colors.line2,
            borderWidth: 1,
            borderRadius: radius.sm,
            paddingHorizontal: 12,
            paddingVertical: 10,
            fontSize: 15,
            minHeight: 60,
            textAlignVertical: "top",
          }}
        />
        <View style={{ marginTop: 10 }}>
          <Btn
            title={sending ? "Gönderiliyor…" : "Yanıtla"}
            variant="primary"
            onPress={reply}
            disabled={sending || !body.trim()}
          />
        </View>
        {err && <Text style={{ color: colors.danger, fontSize: 13, marginTop: 8 }}>{err}</Text>}
      </Card>
    </Screen>
  );
}

