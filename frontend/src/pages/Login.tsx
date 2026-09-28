import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth, useDemoEnabled } from "../auth/AuthContext";
import { api, ApiError } from "../api/client";
import { Wordmark } from "../components/Brand";
import { DemoButtons } from "../components/DemoButtons";
import { UNIVERSITIES } from "../lib/universities";

/** Giriş. `admin`: kurucu/yönetici girişi (e-posta) — yalnızca bağlantısı verilmeyen
 *  VITE_ADMIN_LOGIN_PATH adresinden açılır; normal giriş ekranında izi yoktur. */
export function Login({ admin = false }: { admin?: boolean }) {
  const { loginSchool, loginEmail } = useAuth();
  const demo = useDemoEnabled();
  const nav = useNavigate();
  const [universities, setUniversities] = useState<string[]>(UNIVERSITIES);
  const [university, setUniversity] = useState(UNIVERSITIES[0]);
  const [schoolNo, setSchoolNo] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // "school": okul/personel no · "email": kurucu/yönetici (e-posta)
  const mode: "school" | "email" = admin ? "email" : "school";
  const [email, setEmail] = useState("");
  // İki adımlı doğrulama açıksa şifreden sonra kod adımı
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const sessionEnded = new URLSearchParams(window.location.search).has("oturum");

  useEffect(() => {
    // Üniversite listesi tek kaynaktan (backend) gelir; ulaşılamazsa sabit liste.
    api<string[]>("/auth/universities", { auth: false })
      .then((list) => {
        if (list.length) {
          setUniversities(list);
          setUniversity((cur) => (list.includes(cur) ? cur : list[0]));
        }
      })
      .catch(() => {
        /* sabit listeyle devam */
      });
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const r =
        mode === "email"
          ? await loginEmail(email.trim(), password, remember)
          : await loginSchool(university, schoolNo.trim(), password, remember);
      setPassword("");
      if (r.done) nav("/panel");
      else setMfaToken(r.mfaToken);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Giriş başarısız.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 440, paddingTop: 56 }}>
      <div style={{ marginBottom: 24 }}>
        <Wordmark size={26} />
      </div>
      <div className="card">
        <h1 style={{ fontSize: 24 }}>
          Hesabına <span className="accent">giriş</span>
        </h1>
        <p className="muted" style={{ marginTop: -6, marginBottom: 14 }}>
          {admin ? "Yönetici hesabının e-postası ve şifresiyle giriş yap." : "Üniversiteni seç; okul/personel numaran ve şifrenle giriş yap."}
        </p>
        {mode === "school" && !mfaToken && (
        <div
          className="panel"
          style={{
            marginBottom: 18,
            padding: "10px 12px",
            fontSize: 12.5,
            borderLeft: "3px solid var(--gold)",
          }}
        >
          <span className="muted">
            <b>Okul sistemine (Proliz/OBS) henüz bağlı değil.</b> Okul şifrenle giriş
            yapılmaz; hesabını yönetici açar ve sana geçici bir şifre verir.
          </span>
        </div>
        )}
        {sessionEnded && !mfaToken && (
          <p className="muted" style={{ fontSize: 13 }}>Oturumun sona erdi; lütfen yeniden giriş yap.</p>
        )}
        {mfaToken ? (
          <MfaStep
            mfaToken={mfaToken}
            remember={remember}
            onDone={() => nav("/panel")}
            onCancel={() => setMfaToken(null)}
          />
        ) : (
        <form onSubmit={submit}>
          {mode === "email" ? (
            <div className="field">
              <label>E-posta</label>
              <input type="email" autoComplete="username" value={email}
                onChange={(e) => setEmail(e.target.value)} autoFocus required />
            </div>
          ) : (
          <>
          <div className="field">
            <label>Üniversite</label>
            <select value={university} onChange={(e) => setUniversity(e.target.value)}>
              {universities.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Öğrenci / Personel No</label>
            <input
              value={schoolNo}
              onChange={(e) => setSchoolNo(e.target.value)}
              inputMode="numeric"
              autoFocus
              required
            />
          </div>
          </>
          )}
          <div className="field">
            <label>Şifre</label>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <div className="field" style={{ marginBottom: 16 }}>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                margin: 0,
                cursor: "pointer",
                color: "var(--ink)",
                fontSize: 14,
                fontWeight: 500,
              }}
            >
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                style={{
                  width: 17,
                  height: 17,
                  padding: 0,
                  margin: 0,
                  flexShrink: 0,
                  accentColor: "var(--gold)",
                }}
              />
              Beni hatırla
            </label>
          </div>
          {err && <p className="error">{err}</p>}
          <button className="btn btn-primary" style={{ width: "100%" }} disabled={busy}>
            {busy ? "Giriş yapılıyor…" : "Giriş yap"}
          </button>
        </form>
        )}

        {demo && !mfaToken && mode === "school" && (
          <div className="panel" style={{ marginTop: 16, padding: 14 }}>
            <div style={{ fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 14, marginBottom: 10 }}>
              Şifresiz dene
            </div>
            <DemoButtons />
            <div className="faint" style={{ fontSize: 12, marginTop: 10 }}>
              Elle giriş: Demo Üniversitesi · şifre <b>parola123</b> · Öğrenci 2025001 / 2025002 · Hoca 9001
            </div>
          </div>
        )}
      </div>
      <p className="faint" style={{ textAlign: "center", fontSize: 12.5, marginTop: 14 }}>
        <Link to="/aydinlatma">Kişisel verilerin korunması (KVKK)</Link>
      </p>
    </div>
  );
}

/** Şifreden sonraki adım: doğrulayıcı uygulamadaki 6 haneli kod ya da yedek kod. */
function MfaStep({
  mfaToken,
  remember,
  onDone,
  onCancel,
}: {
  mfaToken: string;
  remember: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { verify2fa } = useAuth();
  const [code, setCode] = useState("");
  const [backup, setBackup] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await verify2fa(mfaToken, code.trim(), remember);
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Doğrulanamadı.");
      if (e instanceof ApiError && e.message.includes("süresi")) onCancel();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <p className="muted" style={{ marginTop: 0 }}>
        {backup
          ? "Kaydettiğin yedek kodlardan birini gir (ör. a1b2-c3d4). Her kod bir kez çalışır."
          : "Telefonundaki doğrulayıcı uygulamada görünen 6 haneli kodu gir."}
      </p>
      <div className="field">
        <label>{backup ? "Yedek kod" : "Doğrulama kodu"}</label>
        <input
          value={code}
          onChange={(e) => setCode(backup ? e.target.value : e.target.value.replace(/\D/g, ""))}
          inputMode={backup ? "text" : "numeric"}
          autoComplete="one-time-code"
          maxLength={backup ? 12 : 6}
          style={{ letterSpacing: backup ? 1 : 4, fontSize: 18 }}
          autoFocus
          required
        />
      </div>
      {err && <p className="error">{err}</p>}
      <button className="btn btn-primary" style={{ width: "100%" }} disabled={busy}>
        {busy ? "Doğrulanıyor…" : "Doğrula ve gir"}
      </button>
      <div className="row between" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setBackup(!backup); setCode(""); }}>
          {backup ? "Uygulama koduyla gir" : "Telefonum yanımda değil"}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Geri</button>
      </div>
    </form>
  );
}
