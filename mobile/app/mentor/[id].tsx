import { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api, ApiError, type ChatMessage } from "../../src/api";
import { colors, fonts, radius } from "../../src/theme";
import { Icon, Sparkle } from "../../src/ui";

export default function MentorScreen() {
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (!id) return;
    api<ChatMessage[]>(`/submissions/${id}/chat`)
      .then(setMessages)
      .catch(() => setErr("Sohbet yüklenemedi."))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(t);
  }, [messages, sending]);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setErr(null);
    setText("");
    setSending(true);
    // İyimser: kullanıcı mesajını hemen göster
    const optimistic: ChatMessage = {
      id: `tmp-${Date.now()}`,
      role: "user",
      content: body,
      created_at: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimistic]);
    try {
      const reply = await api<ChatMessage>(`/submissions/${id}/chat`, {
        method: "POST",
        body: { message: body },
      });
      setMessages((m) => [...m, reply]);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Gönderilemedi.");
    } finally {
      setSending(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Başlık */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: 16,
            paddingVertical: 12,
            borderBottomWidth: 1,
            borderBottomColor: colors.line,
          }}
        >
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Geri"
            style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center", marginLeft: -10 }}
          >
            <Icon name="chevron-left" size={24} />
          </Pressable>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Sparkle size={15} color={colors.blueSoft} />
            <Text style={{ color: colors.ink, fontSize: 16, fontFamily: fonts.ui }}>AI Mentor</Text>
          </View>
          <View style={{ width: 44 }} />
        </View>

        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
          keyboardShouldPersistTaps="handled"
        >
          {!loading && messages.length === 0 && (
            <View
              style={{
                backgroundColor: colors.bg2,
                borderColor: colors.line,
                borderWidth: 1,
                borderRadius: radius.md,
                padding: 16,
              }}
            >
              <Text style={{ color: colors.ink, fontSize: 15, fontWeight: "700", marginBottom: 6 }}>
                Kodun hakkında sor
              </Text>
              <Text style={{ color: colors.muted, fontSize: 13.5, lineHeight: 20 }}>
                AI mentor cevabı doğrudan vermeden seni doğru yöne yönlendirir.
                Örn: “Bu fonksiyonu nasıl daha okunabilir yaparım?”
              </Text>
            </View>
          )}

          {messages.map((m) => (
            <Bubble key={m.id} role={m.role} content={m.content} />
          ))}

          {sending && <Bubble role="assistant" content="…" />}
        </ScrollView>

        {err && (
          <Text style={{ color: colors.danger, fontSize: 13, paddingHorizontal: 16, paddingBottom: 4 }}>
            {err}
          </Text>
        )}

        {/* Giriş çubuğu */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-end",
            gap: 8,
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderTopWidth: 1,
            borderTopColor: colors.line,
            backgroundColor: colors.bg2,
          }}
        >
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Mentora sor…"
            placeholderTextColor={colors.faint}
            multiline
            style={{
              flex: 1,
              maxHeight: 120,
              color: colors.ink,
              backgroundColor: colors.bg,
              borderColor: colors.line2,
              borderWidth: 1,
              borderRadius: radius.sm,
              paddingHorizontal: 12,
              paddingVertical: 10,
              fontSize: 15,
            }}
          />
          <Pressable
            onPress={send}
            disabled={sending || !text.trim()}
            style={{
              backgroundColor: colors.blue,
              opacity: sending || !text.trim() ? 0.5 : 1,
              borderRadius: radius.sm,
              paddingHorizontal: 16,
              paddingVertical: 12,
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "700" }}>Gönder</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Bubble({ role, content }: { role: "user" | "assistant"; content: string }) {
  const mine = role === "user";
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: mine ? "flex-end" : "flex-start",
        marginBottom: 10,
      }}
    >
      {!mine && (
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            backgroundColor: colors.blue,
            alignItems: "center",
            justifyContent: "center",
            marginRight: 8,
          }}
        >
          <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>AI</Text>
        </View>
      )}
      <View
        style={{
          maxWidth: "82%",
          backgroundColor: mine ? colors.goldBg : colors.bg3,
          borderColor: mine ? colors.goldDim : colors.line,
          borderWidth: 1,
          borderRadius: 14,
          borderTopRightRadius: mine ? 3 : 14,
          borderTopLeftRadius: mine ? 14 : 3,
          paddingHorizontal: 13,
          paddingVertical: 10,
        }}
      >
        <Text style={{ color: colors.ink, fontSize: 14.5, lineHeight: 20 }}>{content}</Text>
      </View>
    </View>
  );
}
