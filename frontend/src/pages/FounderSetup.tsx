import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { TwoFactorSetup } from "../api/types";
import { Wordmark } from "../components/Brand";
import { ADMIN_LOGIN_PATH } from "../config";
import { AuthenticatorStep, BackupCodes } from "../components/security/SecurityParts";

type Start = TwoFactorSetup & { setup_id: string };

/** Kurucu hesabının tek seferlik kurulumu (/kurulum).
 *  Kurulum anahtarı yalnızca Render'daki FOUNDER_SETUP_TOKEN'dır; hesap oluşunca sayfa kapanır. */
export function FounderSetup() {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [form, setForm] = useState({ setup_token: "", full_name: "", email: "", password: "", again: "" });
  const [start, setStart] = useState<Start | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ available: boolean; reason?: string | null }>("/auth/founder-setup", { auth: false })
      .then((r) => {
        setAvailable(r.available);
        setReason(r.reason ?? null);
      })
      .catch(() => {
        setAvailable(false);
        setReason("unreachable");
      });
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (form.password !== form.again) return setErr("Şifreler aynı değil.");
    setBusy(true);
    try {
      const { again: _again, ...body } = form;
      setStart(await api<Start>("/auth/founder-setup/start", { method: "POST", auth: false, body }));
      setForm((f) => ({ ...f, password: "", again: "", setup_token: "" }));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Kurulum başlatılamadı.");
    } finally {
      setBusy(false);
    }
  }

  async function finish(code: string) {
    if (!start) return;
    setErr(null);
    setBusy(true);
    try {
      const r = await api<{ backup_codes: string[] }>("/auth/founder-setup/finish", {
        method: "POST",
        auth: false,
        body: { setup_id: start.setup_id, code },
      });
      setCodes(r.backup_codes);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Doğrulanamadı.");
      if (e instanceof ApiError && e.message.includes("süresi")) setStart(null);
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="container" style={{ maxWidth: 520, paddingTop: 48, paddingBottom: 48 }}>
      <div style={{ marginBottom: 24 }}>
        <Wordmark size={26} />
      </div>
      <div className="card">
        <h1 style={{ fontSize: 23 }}>
          Kurucu hesabı <span className="accent">kurulumu</span>
        </h1>
        {available === null ? (
          <p className="muted">Kontrol ediliyor…</p>
        ) : codes ? (
          <>
            <p className="ok">Kurucu hesabın oluşturuldu.</p>
            <BackupCodes codes={codes} />
            <p className="muted" style={{ fontSize: 13 }}>
              Kurulum artık kapalı. İstersen Render'daki <code>FOUNDER_SETUP_TOKEN</code> değişkenini silebilirsin.
            </p>
            <p className="muted" style={{ fontSize: 13 }}>
              Girişin bu adresten yapılır; bir yere kaydet (giriş ekranında bağlantısı yoktur):{" "}
              <b>{window.location.origin}{ADMIN_LOGIN_PATH ?? " (Vercel'de VITE_ADMIN_LOGIN_PATH tanımlanmalı)"}</b>
            </p>
            {ADMIN_LOGIN_PATH && <Link className="btn btn-primary" to={ADMIN_LOGIN_PATH}>Girişe git</Link>}
          </>
        ) : !available ? (
          <p className="muted">
            Kurulum kapalı:{" "}
            {reason === "closed"
              ? "bu sayfa artık kullanılmıyor."
              : reason === "short_token"
                ? "sunucudaki FOUNDER_SETUP_TOKEN en az 24 karakter olmalı."
                : reason === "unreachable"
                  ? "sunucuya ulaşılamadı; biraz sonra sayfayı yenile."
                  : "sunucuda FOUNDER_SETUP_TOKEN tanımlı değil. Render'da ekledikten sonra sunucunun yeniden başlaması birkaç dakika sürer; sonra bu sayfayı yenile."}
          </p>
        ) : start ? (
          <>
            <p className="muted" style={{ marginTop: -4 }}>
              Son adım: yönetici hesabında iki adımlı doğrulama zorunludur. Şifren ele geçse bile telefonun
              olmadan hesaba girilemez.
            </p>
            <AuthenticatorStep setup={start} onCode={finish} busy={busy} err={err} />
          </>
        ) : (
          <form onSubmit={submit}>
            <p className="muted" style={{ marginTop: -4 }}>
              Bu sayfa yalnızca bir kez çalışır. Şifreni kimseyle paylaşma; bir şifre yöneticisinde sakla.
            </p>
            <div className="field">
              <label>Kurulum anahtarı</label>
              <input type="password" autoComplete="off" value={form.setup_token} onChange={set("setup_token")} required />
            </div>
            <div className="field">
              <label>Ad Soyad</label>
              <input value={form.full_name} onChange={set("full_name")} required />
            </div>
            <div className="field">
              <label>E-posta (giriş adın olacak)</label>
              <input type="email" autoComplete="username" value={form.email} onChange={set("email")} required />
            </div>
            <div className="field">
              <label>Şifre</label>
              <input type="password" autoComplete="new-password" value={form.password} onChange={set("password")} required />
            </div>
            <div className="field">
              <label>Şifre (tekrar)</label>
              <input type="password" autoComplete="new-password" value={form.again} onChange={set("again")} required />
            </div>
            <p className="faint" style={{ fontSize: 12, marginTop: -4 }}>
              En az 14 karakter; harf ve rakam/işaret içermeli; adını veya e-postanı içermemeli. Uzun bir cümle
              (ör. dört rastgele kelime) en güvenlisidir.
            </p>
            {err && <p className="error">{err}</p>}
            <button className="btn btn-primary" disabled={busy}>{busy ? "Kontrol ediliyor…" : "Devam"}</button>
          </form>
        )}
      </div>
    </div>
  );
}
