import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { SecurityInfo, SessionInfo, TwoFactorSetup } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { AuthenticatorStep, BackupCodes, ChangePasswordForm } from "../components/security/SecurityParts";
import { formatDate } from "../lib/format";
import { deviceLabel, eventLabel, isBadEvent } from "../lib/security";

const roleLabel: Record<string, string> = {
  student: "Öğrenci",
  academician: "Akademisyen",
  admin: "Yönetici",
};

export function Profile() {
  const { user, logout } = useAuth();
  if (!user) return null;
  // Proliz-tarzi: ogrenci okul numarasiyla giris yapar; dahili e-posta gosterilmez.
  const rows: [string, string][] = [
    ["Ad Soyad", user.full_name],
    ["Rol", user.is_founder ? "Kurucu" : roleLabel[user.role] ?? user.role],
    ...(user.school_no ? ([["Okul / Personel No", user.school_no]] as [string, string][]) : []),
    ...(user.university ? ([["Üniversite", user.university]] as [string, string][]) : []),
    ...(user.role === "student" ? [] : ([["E-posta", user.email]] as [string, string][])),
  ];
  return (
    <div style={{ maxWidth: 640 }}>
      <h1 className="h-page" style={{ marginBottom: 18 }}>Profil</h1>
      <div className="card">
        {rows.map(([k, v], i) => (
          <div key={k}>
            {i > 0 && <hr style={{ margin: "12px 0" }} />}
            <div className="row between" style={{ gap: 10 }}>
              <span className="muted" style={{ fontSize: 13 }}>{k}</span>
              <span style={{ fontWeight: 500, textAlign: "right", wordBreak: "break-word" }}>{v}</span>
            </div>
          </div>
        ))}
      </div>

      <SecuritySection />

      <p className="muted" style={{ fontSize: 13, marginTop: 14 }}>
        Verilerinin nasıl işlendiğini <a href="/aydinlatma">KVKK aydınlatma metninde</a> okuyabilirsin.
      </p>

      <button
        className="btn"
        style={{ marginTop: 16 }}
        onClick={async () => {
          await logout();
          window.location.href = "/giris";
        }}
      >
        Çıkış yap
      </button>
    </div>
  );
}

function SecuritySection() {
  const { user, applySession, refreshUser, logout } = useAuth();
  const [info, setInfo] = useState<SecurityInfo | null>(null);
  const [open, setOpen] = useState<null | "password" | "2fa" | "disable">(null);
  const [msg, setMsg] = useState<string | null>(null);

  function load() {
    api<SecurityInfo>("/auth/security").then(setInfo).catch(() => {});
  }
  useEffect(load, []);
  if (!user) return null;

  async function logoutAll() {
    if (!window.confirm("Bu cihaz dahil tüm cihazlardaki oturumların kapansın mı? Yeniden giriş yapman gerekecek."))
      return;
    try {
      await api("/auth/logout-all", { method: "POST" });
    } finally {
      await logout();
      window.location.href = "/giris";
    }
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3 style={{ fontSize: 17, marginTop: 0 }}>Güvenlik</h3>
      {user.is_demo ? (
        <p className="muted" style={{ fontSize: 13.5 }}>
          Bu bir <b>demo hesabı</b>: şifresi herkese açık olduğundan şifre ve iki adımlı doğrulama ayarları
          kapalıdır. Kendi verini burada tutma.
        </p>
      ) : (
        <>
          {msg && <p className="ok" style={{ fontSize: 13.5 }}>{msg}</p>}
          <div className="stack" style={{ gap: 10 }}>
            <Row
              title="Şifre"
              desc="Değiştirince diğer cihazlardaki oturumların kapanır."
              action={
                <button className="btn btn-sm" onClick={() => setOpen(open === "password" ? null : "password")}>
                  {open === "password" ? "Vazgeç" : "Değiştir"}
                </button>
              }
            />
            {open === "password" && (
              <div className="panel" style={{ padding: 14 }}>
                <ChangePasswordForm
                  minLength={user.role === "admin" ? 14 : 10}
                  onDone={(res) => {
                    applySession(res);
                    setOpen(null);
                    setMsg("Şifren değiştirildi; diğer cihazlardaki oturumlar kapatıldı.");
                    load();
                  }}
                />
              </div>
            )}

            <Row
              title="İki adımlı doğrulama"
              desc={
                info?.totp_enabled
                  ? `Açık · ${info.backup_codes_left} yedek kod kaldı. Şifren ele geçse bile telefonun olmadan girilemez.`
                  : "Kapalı. Açarsan girişte şifreye ek olarak telefonundaki kod istenir — önerilir."
              }
              action={
                info?.totp_enabled ? (
                  user.role === "admin" ? (
                    <span className="chip chip-ok">Zorunlu · açık</span>
                  ) : (
                    <button className="btn btn-sm btn-danger-ghost" onClick={() => setOpen(open === "disable" ? null : "disable")}>
                      {open === "disable" ? "Vazgeç" : "Kapat"}
                    </button>
                  )
                ) : (
                  <button className="btn btn-sm btn-primary" onClick={() => setOpen(open === "2fa" ? null : "2fa")}>
                    {open === "2fa" ? "Vazgeç" : "Aç"}
                  </button>
                )
              }
            />
            {open === "2fa" && (
              <TwoFactorEnable
                onDone={() => {
                  load();
                  refreshUser().catch(() => {});
                }}
                onClose={() => setOpen(null)}
              />
            )}
            {open === "disable" && (
              <TwoFactorDisable
                onDone={() => {
                  setOpen(null);
                  setMsg("İki adımlı doğrulama kapatıldı.");
                  load();
                  refreshUser().catch(() => {});
                }}
              />
            )}

            <Row
              title="Tüm cihazlardan çıkış"
              desc="Başka bir yerde açık kaldığını düşündüğün oturumları kapatır."
              action={<button className="btn btn-sm" onClick={logoutAll}>Çıkış yap</button>}
            />
          </div>
        </>
      )}

      <ActiveSessions />

      <div style={{ marginTop: 18 }}>
        <div className="eyebrow">Son hesap hareketleri</div>
        <p className="faint" style={{ fontSize: 12, margin: "2px 0 8px" }}>
          Tanımadığın bir giriş görürsen hemen şifreni değiştir.
        </p>
        {!info ? (
          <span className="faint">Yükleniyor…</span>
        ) : info.events.length === 0 ? (
          <span className="faint">Henüz kayıt yok.</span>
        ) : (
          <div className="stack" style={{ gap: 6 }}>
            {info.events.map((e) => (
              <div key={e.id} className="row between" style={{ gap: 10, fontSize: 13, flexWrap: "wrap" }}>
                <span>
                  <span className={isBadEvent(e.event) ? "chip chip-danger" : "chip"} style={{ marginRight: 6 }}>
                    {eventLabel(e.event)}
                  </span>
                  <span className="muted">
                    {e.actor_name ? `yönetici: ${e.actor_name}` : `${deviceLabel(e.user_agent)}${e.ip ? ` · ${e.ip}` : ""}`}
                  </span>
                </span>
                <span className="faint">{formatDate(e.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Açık oturumlar (cihazlar): tanımadığın bir cihazı buradan kapatırsın. */
function ActiveSessions() {
  const [list, setList] = useState<SessionInfo[] | null>(null);
  function load() {
    api<SessionInfo[]>("/auth/sessions").then(setList).catch(() => setList([]));
  }
  useEffect(load, []);
  async function close(s: SessionInfo) {
    if (!window.confirm(`${s.device} oturumu kapatılsın mı? O cihaz yeniden giriş yapmak zorunda kalır.`)) return;
    try {
      await api(`/auth/sessions/${s.id}`, { method: "DELETE" });
    } finally {
      load();
    }
  }
  if (!list || list.length === 0) return null;
  return (
    <div style={{ marginTop: 18 }}>
      <div className="eyebrow">Aktif oturumlar</div>
      <p className="faint" style={{ fontSize: 12, margin: "2px 0 8px" }}>
        Hesabının açık olduğu cihazlar. Yeni bir cihazdan girildiğinde sana bildirim gelir.
      </p>
      <div className="stack" style={{ gap: 6 }}>
        {list.map((s) => (
          <div key={s.id} className="row between" style={{ gap: 10, fontSize: 13, flexWrap: "wrap" }}>
            <span>
              <b>{s.device}</b>{" "}
              {s.current && <span className="chip chip-ok" style={{ marginLeft: 4 }}>Bu cihaz</span>}
              <span className="muted">
                {" "}· {s.client === "mobile" ? "uygulama" : "web"}
                {s.ip ? ` · ${s.ip}` : ""} · son etkinlik {formatDate(s.last_seen_at)}
              </span>
            </span>
            {!s.current && (
              <button className="btn btn-ghost btn-sm btn-danger-ghost" onClick={() => close(s)}>Kapat</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({ title, desc, action }: { title: string; desc: string; action: React.ReactNode }) {
  return (
    <div className="row between" style={{ gap: 12, flexWrap: "wrap" }}>
      <div style={{ minWidth: 0, flex: "1 1 260px" }}>
        <div style={{ fontWeight: 600 }}>{title}</div>
        <div className="muted" style={{ fontSize: 13 }}>{desc}</div>
      </div>
      {action}
    </div>
  );
}

function TwoFactorEnable({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      setSetup(await api<TwoFactorSetup>("/auth/2fa/setup", { method: "POST", body: { password } }));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Başlatılamadı.");
    } finally {
      setBusy(false);
    }
  }

  async function enable(code: string) {
    setErr(null);
    setBusy(true);
    try {
      const r = await api<{ backup_codes: string[] }>("/auth/2fa/enable", { method: "POST", body: { code } });
      setCodes(r.backup_codes);
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Doğrulanamadı.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel" style={{ padding: 14 }}>
      {codes ? (
        <BackupCodes codes={codes} onClose={onClose} />
      ) : setup ? (
        <AuthenticatorStep setup={setup} onCode={enable} busy={busy} err={err} />
      ) : (
        <form onSubmit={start}>
          <div className="field">
            <label>Devam etmek için şifreni gir</label>
            <input type="password" autoComplete="current-password" value={password}
              onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {err && <p className="error">{err}</p>}
          <button className="btn btn-primary" disabled={busy}>{busy ? "…" : "Devam"}</button>
        </form>
      )}
    </div>
  );
}

function TwoFactorDisable({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api("/auth/2fa/disable", { method: "POST", body: { password, code } });
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Kapatılamadı.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="panel" style={{ padding: 14 }} onSubmit={submit}>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Kapatırsan hesabın yalnızca şifreyle korunur. Onaylamak için şifreni ve güncel kodu gir.
      </p>
      <div className="field">
        <label>Şifre</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      <div className="field">
        <label>Doğrulama kodu veya yedek kod</label>
        <input value={code} onChange={(e) => setCode(e.target.value)} required />
      </div>
      {err && <p className="error">{err}</p>}
      <button className="btn btn-danger-ghost" disabled={busy}>{busy ? "…" : "İki adımlı doğrulamayı kapat"}</button>
    </form>
  );
}
