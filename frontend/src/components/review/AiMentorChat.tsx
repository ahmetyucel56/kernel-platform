import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../../api/client";

interface ChatMsg {
  id: string;
  role: string; // user | assistant
  content: string;
  created_at?: string;
}

/** Ogrenci-AI mentor sohbeti (spec 7.7) — yalnizca gonderim sahibi ogrenci. */
export function AiMentorChat({ submissionId }: { submissionId: string }) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<ChatMsg[]>(`/submissions/${submissionId}/chat`).then(setMessages).catch(() => {});
  }, [submissionId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setErr(null);
    setBusy(true);
    // iyimser: kullanici mesajini hemen goster
    setMessages((m) => [...m, { id: "tmp-" + Date.now(), role: "user", content: text }]);
    setInput("");
    try {
      const assistant = await api<ChatMsg>(`/submissions/${submissionId}/chat`, {
        method: "POST",
        body: { message: text },
      });
      setMessages((m) => [...m, assistant]);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Gönderilemedi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 18, borderColor: "var(--blue-soft)" }}>
      <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ fontSize: 16, margin: 0 }}>
          <span style={{ color: "var(--blue-soft)" }}>AI</span> Mentor
        </h3>
        <span className="tag tag-blue">İpucu verir, çözmez</span>
      </div>
      <p className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
        Kodun hakkında soru sor; mentor yol gösterir (hazır cevap vermez).
      </p>

      <div
        style={{
          marginTop: 12,
          maxHeight: "42vh",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          padding: "4px 2px",
        }}
      >
        {messages.length === 0 && (
          <span className="muted" style={{ fontSize: 13 }}>
            Örnek: “main.py neden hata veriyor?” ya da “bu fonksiyonu nasıl sadeleştiririm?”
          </span>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "85%",
              background: m.role === "user" ? "var(--blue)" : "var(--bg-3)",
              color: m.role === "user" ? "#fff" : "var(--ink)",
              border: m.role === "user" ? "none" : "1px solid var(--line)",
              borderRadius: 12,
              padding: "9px 12px",
              fontSize: 13.5,
              whiteSpace: "pre-wrap",
            }}
          >
            {m.content}
          </div>
        ))}
        {busy && <span className="faint" style={{ fontSize: 12 }}>Mentor yazıyor…</span>}
        <div ref={endRef} />
      </div>

      {err && <p className="error">{err}</p>}
      <form onSubmit={send} className="row" style={{ gap: 8, marginTop: 10 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Sorunu yaz…"
          disabled={busy}
        />
        <button className="btn btn-primary" disabled={busy || !input.trim()}>
          Gönder
        </button>
      </form>
    </div>
  );
}
