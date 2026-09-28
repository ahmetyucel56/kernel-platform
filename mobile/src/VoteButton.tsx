import { useState } from "react";
import { Pressable, Text } from "react-native";
import { api } from "./api";
import { colors } from "./theme";

/** Reddit tarzı upvote (beğeni). Kendi sayacını yönetir; dokununca toggle. */
export function VoteButton({
  postId,
  votes,
  voted,
}: {
  postId: string;
  votes: number;
  voted: boolean;
}) {
  const [v, setV] = useState({ votes, voted });
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await api<{ votes: number; voted: boolean }>(`/posts/${postId}/vote`, {
        method: "POST",
      });
      setV(r);
    } catch {
      /* yut */
    } finally {
      setBusy(false);
    }
  }

  return (
    <Pressable
      onPress={toggle}
      hitSlop={8}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingVertical: 3,
        paddingHorizontal: 9,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: v.voted ? colors.goldDim : colors.line2,
        backgroundColor: v.voted ? colors.goldBg : "transparent",
      }}
    >
      <Text style={{ color: v.voted ? colors.gold : colors.muted, fontSize: 13, fontWeight: "700" }}>
        ▲ {v.votes}
      </Text>
    </Pressable>
  );
}
