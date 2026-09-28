import { useState } from "react";
import { api, ApiError } from "../../api/client";
import type { TokenResponse, TwoFactorSetup as Setup } from "../../api/types";
import { PASSWORD_RULES } from "../../lib/security";

/** Şifre değiştirme formu. Başarıda sunucu yeni oturum döndürür (diğer cihazlar kapanır). */
export function ChangePasswordForm({
  onDone,
  minLength = 10,
  submitLabel = "Şifreyi değiştir",
}: {
  onDone: (res: TokenResponse) => void;
  minLength?: number;
  submitLabel?: string;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (next !== again) return setErr("Yeni şifreler aynı değil.");
    if (next.length < minLength) return setErr(`Yeni şifre en az ${minLength} karakter olmalı.`);
    setBusy(true);
    try {
      const res = await api<TokenResponse>("/auth/change-password", {
        method: "POST",
        body: { current_password: current, new_password: next },
      });
      setCurrent("");
      setNext("");
      setAgain("");
      onDone(res);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Şifre değiştirilemedi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="field">
        <label>Mevcut şifre</label>
        <input type="password" autoComplete="current-password" value={current}
          onChange={(e) => setCurrent(e.target.value)} required />
      </div>
      <div className="field">
        <label>Yeni şifre</label>
        <input type="password" autoComplete="new-password" value={next}
          onChange={(e) => setNext(e.target.value)} required />
      </div>
      <div className="field">
        <label>Yeni şifre (tekrar)</label>
        <input type="password" autoComplete="new-password" value={again}
          onChange={(e) => setAgain(e.target.value)} required />
      </div>
      <p className="faint" style={{ fontSize: 12, marginTop: -4 }}>{PASSWORD_RULES}</p>
      {err && <p className="error">{err}</p>}
      <button className="btn btn-primary" disabled={busy}>{busy ? "Kaydediliyor…" : submitLabel}</button>
    </form>
  );
}

/** Yedek kodlar: yalnızca bir kez gösterilir; indir/kopyala. */
export function BackupCodes({ codes, onClose }: { codes: string[]; onClose?: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = `Kernel yedek kodları (her biri bir kez kullanılır)\n\n${codes.join("\n")}\n`;
  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "kernel-yedek-kodlar.txt";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="panel" style={{ padding: 14, borderLeft: "3px solid var(--gold)" }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Yedek kodların</div>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Telefonuna erişemezsen bu kodlarla girersin; her biri <b>bir kez</b> çalışır. Şimdi güvenli bir yere
        kaydet (şifre yöneticisi ideal). Bu kodlar bir daha gösterilmeyecek.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6,
        fontFamily: "var(--font-mono, monospace)", fontSize: 15, margin: "10px 0" }}>
        {codes.map((c) => <code key={c}>{c}</code>)}
      </div>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button className="btn btn-sm" type="button" onClick={download}>İndir (.txt)</button>
        <button className="btn btn-sm" type="button" onClick={() => {
          navigator.clipboard?.writeText(codes.join("\n")).then(() => setCopied(true)).catch(() => {});
        }}>{copied ? "Kopyalandı" : "Kopyala"}</button>
        {onClose && <button className="btn btn-sm btn-primary" type="button" onClick={onClose}>Kaydettim</button>}
      </div>
    </div>
  );
}

/** QR + elle giriş anahtarı + doğrulama kodu. (Kurulum ve kurucu kaydında ortak.) */
export function AuthenticatorStep({
  setup,
  onCode,
  busy,
  err,
}: {
  setup: Setup;
  onCode: (code: string) => void;
  busy: boolean;
  err: string | null;
}) {
  const [code, setCode] = useState("");
  return (
    <div>
      <ol className="muted" style={{ fontSize: 13.5, paddingLeft: 18, marginTop: 0 }}>
        <li>Telefonuna bir doğrulayıcı uygulama kur (Google Authenticator, Microsoft Authenticator…).</li>
        <li>Uygulamada “QR kodu tara” deyip aşağıdaki kodu okut.</li>
        <li>Uygulamanın gösterdiği 6 haneli kodu yaz.</li>
      </ol>
      <div className="row" style={{ gap: 16, flexWrap: "wrap", alignItems: "center" }}>
        <img src={setup.qr} alt="Doğrulayıcı uygulama QR kodu" width={180} height={180}
          style={{ borderRadius: 8, background: "#fff", imageRendering: "pixelated" }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="faint" style={{ fontSize: 12 }}>QR okutamıyorsan bu anahtarı elle gir:</div>
          <code style={{ wordBreak: "break-all", fontSize: 13 }}>{setup.secret.replace(/(.{4})/g, "$1 ").trim()}</code>
        </div>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onCode(code.trim());
        }}
        className="row"
        style={{ gap: 8, marginTop: 14, flexWrap: "wrap" }}
      >
        <input inputMode="numeric" autoComplete="one-time-code" placeholder="6 haneli kod" maxLength={6}
          value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          style={{ width: 160, letterSpacing: 3, fontSize: 18 }} required />
        <button className="btn btn-primary" disabled={busy || code.length !== 6}>
          {busy ? "Doğrulanıyor…" : "Doğrula"}
        </button>
      </form>
      {err && <p className="error">{err}</p>}
    </div>
  );
}
