import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../../api/client";
import type { AdminSettings, AdminStats, AdminUser, SecurityEvent } from "../../api/types";
import { useAuth } from "../../auth/AuthContext";
import { formatDate } from "../../lib/format";
import { deviceLabel, eventLabel, isBadEvent } from "../../lib/security";

type Tab = "overview" | "users" | "events";
const ROLE: Record<string, string> = { student: "Öğrenci", academician: "Akademisyen", admin: "Yönetici" };

/** Kurucu paneli: sistem özeti + ayarlar, hesap yönetimi, güvenlik kayıtları. */
export function AdminPanel() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("overview");
  const [eventUser, setEventUser] = useState<AdminUser | null>(null);
  if (!user || user.role !== "admin") return <p className="muted">Bu sayfa yalnızca yöneticiye açıktır.</p>;

  return (
    <div>
      <h1 className="h-page">Yönetim</h1>
      <p className="muted" style={{ marginTop: -6 }}>
        Tüm sınıflar, ödevler ve topluluklar zaten sana açık (<Link to="/panel">Panom</Link>,{" "}
        <Link to="/topluluk">Topluluk</Link>). Burada hesapları ve güvenliği yönetirsin.
      </p>
      <div className="tabs" role="tablist" style={{ margin: "14px 0 18px" }}>
        {([
          ["overview", "Genel bakış"],
          ["users", "Kullanıcılar"],
          ["events", "Güvenlik kayıtları"],
        ] as [Tab, string][]).map(([k, label]) => (
          <button key={k} role="tab" className={"tab" + (tab === k ? " on" : "")} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {tab === "overview" && <Overview onShowFailures={() => setTab("events")} />}
      {tab === "users" && (
        <Users
          onShowEvents={(u) => {
            setEventUser(u);
            setTab("events");
          }}
        />
      )}
      {tab === "events" && <Events user={eventUser} onClearUser={() => setEventUser(null)} />}
    </div>
  );
}

/* ---------------- Genel bakış + ayarlar ---------------- */
function Overview({ onShowFailures }: { onShowFailures: () => void }) {
  const [s, setS] = useState<AdminStats | null>(null);
  const [cfg, setCfg] = useState<AdminSettings | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function load() {
    api<AdminStats>("/admin/stats").then(setS).catch(() => {});
    api<AdminSettings>("/admin/settings").then(setCfg).catch(() => {});
  }
  useEffect(load, []);

  async function toggleDemo() {
    if (!cfg) return;
    setErr(null);
    try {
      setCfg(await api<AdminSettings>("/admin/settings", { method: "PUT", body: { demo_login: !cfg.demo_login } }));
      setMsg(cfg.demo_login ? "Demo girişi kapatıldı." : "Demo girişi açıldı.");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Kaydedilemedi.");
    }
  }

  async function purgeDemo() {
    const typed = window.prompt(
      `Tüm demo hesapları (${s?.demo_users ?? 0}) ve onların sınıfları, ödevleri, teslimleri KALICI olarak silinecek; ` +
        `demo girişi kapanacak ve açılışta yeniden oluşturulmayacak.\n\nOnaylamak için SİL yaz:`
    );
    if (typed?.trim().toLocaleUpperCase("tr") !== "SİL") return;
    setErr(null);
    try {
      const r = await api<{ deleted: number }>("/admin/demo/purge", { method: "POST" });
      setMsg(`${r.deleted} demo hesap ve verileri silindi; demo girişi kapatıldı.`);
      load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Silinemedi.");
    }
  }

  const tiles: [string, number | string][] = s
    ? [
        ["Öğrenci", s.users.student ?? 0],
        ["Akademisyen", s.users.academician ?? 0],
        ["Sınıf", s.classes],
        ["Ödev", s.assignments],
        ["Teslim", s.submissions],
        ["AI analizi (7 gün)", s.analyses_7d],
        ["Topluluk", s.communities],
        ["Demo hesap", s.demo_users],
      ]
    : [];

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
        {tiles.map(([k, v]) => (
          <div key={k} className="panel" style={{ padding: "12px 14px" }}>
            <div className="faint" style={{ fontSize: 12 }}>{k}</div>
            <div style={{ fontSize: 24, fontWeight: 700, fontFamily: "var(--font-display)" }}>{v}</div>
          </div>
        ))}
      </div>

      {s && (s.failed_logins_24h > 0 || s.locked_users > 0 || s.inactive_users > 0) && (
        <div className="panel" style={{ padding: 12, borderLeft: "3px solid var(--danger)" }}>
          <b>Dikkat:</b>{" "}
          <span className="muted">
            Son 24 saatte {s.failed_logins_24h} hatalı giriş denemesi · {s.locked_users} kilitli hesap ·{" "}
            {s.inactive_users} devre dışı hesap.
          </span>{" "}
          <button className="btn btn-ghost btn-sm" onClick={onShowFailures}>Kayıtlara bak</button>
        </div>
      )}

      <div className="card">
        <h3 style={{ fontSize: 16, marginTop: 0 }}>Ayarlar</h3>
        {msg && <p className="ok" style={{ fontSize: 13.5 }}>{msg}</p>}
        {err && <p className="error">{err}</p>}
        {cfg && (
          <div className="stack" style={{ gap: 14 }}>
            <div className="row between" style={{ gap: 12, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 280px" }}>
                <div style={{ fontWeight: 600 }}>Demo girişi ("Hoca/Öğrenci olarak dene")</div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {cfg.demo_login
                    ? "Açık: giriş ekranında herkes şifresiz demo hesaplarla girebilir."
                    : "Kapalı: demo düğmeleri görünmez, demo hesaplarla giriş yapılamaz."}
                </div>
              </div>
              <button className={"btn btn-sm" + (cfg.demo_login ? "" : " btn-primary")} onClick={toggleDemo}>
                {cfg.demo_login ? "Kapat" : "Aç"}
              </button>
            </div>
            <div className="row between" style={{ gap: 12, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 280px" }}>
                <div style={{ fontWeight: 600 }}>Demo verisini sil</div>
                <div className="muted" style={{ fontSize: 13 }}>
                  Tanıtım bittiğinde: tüm demo hesapları, tanıtım sınıfları ve teslimleri kalıcı olarak siler.
                </div>
              </div>
              <button className="btn btn-sm btn-danger-ghost" onClick={purgeDemo} disabled={!s?.demo_users}>
                Demo verisini sil
              </button>
            </div>
            {!cfg.jwt_secret_from_env && (
              <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                ⚠ Oturum anahtarı sunucu ortamında (JWT_SECRET) tanımlı değil; geçici olarak veritabanında üretilmiş
                anahtar kullanılıyor. Render'da uzun rastgele bir JWT_SECRET tanımlaman önerilir.
              </p>
            )}
            {cfg.founder_setup_open && (
              <p className="error" style={{ fontSize: 13, margin: 0 }}>Kurulum sayfası hâlâ açık görünüyor.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Kullanıcılar ---------------- */
function Users({ onShowEvents }: { onShowEvents: (u: AdminUser) => void }) {
  const [list, setList] = useState<AdminUser[] | null>(null);
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [kind, setKind] = useState("");
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ user: AdminUser; temp_password: string; why: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function load() {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (role) p.set("role", role);
    if (kind) p.set("kind", kind);
    api<AdminUser[]>(`/admin/users?${p}`).then(setList).catch(() => setList([]));
  }
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, role, kind]);

  async function act(u: AdminUser, action: string) {
    setErr(null);
    const name = u.full_name;
    try {
      if (action === "reset") {
        if (!window.confirm(`${name} için geçici şifre oluşturulsun mu? Açık oturumları kapanır.`)) return;
        const r = await api<{ user: AdminUser; temp_password: string }>(`/admin/users/${u.id}/reset-password`, { method: "POST" });
        setSecret({ ...r, why: "Şifre sıfırlandı" });
      } else if (action === "logout") {
        await api(`/admin/users/${u.id}/logout`, { method: "POST" });
      } else if (action === "unlock") {
        await api(`/admin/users/${u.id}/unlock`, { method: "POST" });
      } else if (action === "2fa") {
        if (!window.confirm(`${name} için iki adımlı doğrulama kapatılsın mı? (Telefonunu kaybettiyse)`)) return;
        await api(`/admin/users/${u.id}/reset-2fa`, { method: "POST" });
      } else if (action === "toggle") {
        if (u.is_active && !window.confirm(`${name} devre dışı bırakılsın mı? Hemen çıkış yapar ve giremez.`)) return;
        await api(`/admin/users/${u.id}`, { method: "PATCH", body: { is_active: !u.is_active } });
      } else if (action === "delete") {
        const typed = window.prompt(
          `${name} KALICI olarak silinecek` +
            (u.role === "academician" ? " — sınıfları, ödevleri ve o ödevlere yapılan TÜM teslimlerle birlikte." : " — teslimleri, ön kontrolleri ve mesajlarıyla birlikte.") +
            `\nGeri alınamaz. Yalnızca girişini engellemek istiyorsan "Devre dışı bırak"ı kullan.\n\nOnaylamak için SİL yaz:`
        );
        if (typed?.trim().toLocaleUpperCase("tr") !== "SİL") return;
        await api(`/admin/users/${u.id}`, { method: "DELETE" });
        setOpen(null);
      }
      load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "İşlem başarısız.");
    }
  }

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <input placeholder="Ad, numara veya e-posta ara" value={q} onChange={(e) => setQ(e.target.value)}
          style={{ flex: "1 1 220px", minWidth: 0 }} />
        <select value={role} onChange={(e) => setRole(e.target.value)} style={{ flex: "0 1 150px" }}>
          <option value="">Tüm roller</option>
          <option value="student">Öğrenci</option>
          <option value="academician">Akademisyen</option>
          <option value="admin">Yönetici</option>
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ flex: "0 1 150px" }}>
          <option value="">Tümü</option>
          <option value="normal">Gerçek hesaplar</option>
          <option value="demo">Demo hesaplar</option>
          <option value="locked">Kilitli</option>
          <option value="inactive">Devre dışı</option>
        </select>
        <button className="btn btn-primary" onClick={() => setCreating(!creating)}>
          {creating ? "Vazgeç" : "Yeni hesap"}
        </button>
      </div>

      {creating && (
        <CreateUser
          onCreated={(r) => {
            setSecret({ ...r, why: "Hesap açıldı" });
            setCreating(false);
            load();
          }}
        />
      )}
      {secret && <TempPassword data={secret} onClose={() => setSecret(null)} />}
      {err && <p className="error">{err}</p>}

      {!list ? (
        <span className="faint">Yükleniyor…</span>
      ) : list.length === 0 ? (
        <span className="faint">Kullanıcı bulunamadı.</span>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          <span className="faint" style={{ fontSize: 12 }}>{list.length} kullanıcı</span>
          {list.map((u) => {
            const protectedUser = u.is_founder || u.role === "admin";
            return (
              <div key={u.id} className="panel" style={{ padding: "10px 12px", opacity: u.is_active ? 1 : 0.65 }}>
                <div className="row between" style={{ gap: 10, flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0, flex: "1 1 260px" }}>
                    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                      <b>{u.full_name}</b>
                      {u.is_founder && <span className="chip chip-gold">Kurucu</span>}
                      {u.is_demo && <span className="chip">Demo</span>}
                      {!u.is_active && <span className="chip chip-danger">Devre dışı</span>}
                      {u.locked && <span className="chip chip-danger">Kilitli</span>}
                      {u.totp_enabled && <span className="chip chip-ok">2FA</span>}
                      {u.must_change_password && <span className="chip">Şifre değişmeli</span>}
                    </div>
                    <div className="muted" style={{ fontSize: 12.5 }}>
                      {ROLE[u.role] ?? u.role}
                      {u.school_no ? ` · ${u.school_no}` : ""}
                      {u.role !== "student" || !u.school_no ? ` · ${u.email}` : ""}
                      {" · "}
                      {u.last_login_at ? `son giriş ${formatDate(u.last_login_at)}` : "hiç giriş yapmadı"}
                    </div>
                  </div>
                  {protectedUser ? (
                    <span className="faint" style={{ fontSize: 12 }}>Korumalı hesap</span>
                  ) : (
                    <button className="btn btn-sm" onClick={() => setOpen(open === u.id ? null : u.id)}>
                      {open === u.id ? "Kapat" : "İşlemler"}
                    </button>
                  )}
                </div>
                {open === u.id && !protectedUser && (
                  <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                    <button className="btn btn-sm" onClick={() => act(u, "reset")}>Şifre sıfırla</button>
                    <button className="btn btn-sm" onClick={() => act(u, "logout")}>Oturumlarını kapat</button>
                    {u.locked && <button className="btn btn-sm" onClick={() => act(u, "unlock")}>Kilidi aç</button>}
                    {u.totp_enabled && <button className="btn btn-sm" onClick={() => act(u, "2fa")}>2FA sıfırla</button>}
                    <button className="btn btn-sm" onClick={() => onShowEvents(u)}>Kayıtlarını gör</button>
                    <button className="btn btn-sm" onClick={() => act(u, "toggle")}>
                      {u.is_active ? "Devre dışı bırak" : "Etkinleştir"}
                    </button>
                    <button className="btn btn-sm btn-danger-ghost" onClick={() => act(u, "delete")}>Kalıcı sil</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CreateUser({ onCreated }: { onCreated: (r: { user: AdminUser; temp_password: string }) => void }) {
  const [f, setF] = useState({ full_name: "", role: "student", school_no: "", university: "Demo Üniversitesi", is_demo: false });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      onCreated(await api<{ user: AdminUser; temp_password: string }>("/admin/users", { method: "POST", body: f }));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Oluşturulamadı.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="card" onSubmit={submit}>
      <h3 style={{ fontSize: 16, marginTop: 0 }}>Yeni hesap</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0 12px" }}>
        <div className="field">
          <label>Ad Soyad</label>
          <input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} required />
        </div>
        <div className="field">
          <label>Rol</label>
          <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            <option value="student">Öğrenci</option>
            <option value="academician">Akademisyen</option>
          </select>
        </div>
        <div className="field">
          <label>{f.role === "student" ? "Öğrenci No" : "Personel No"} (giriş adı)</label>
          <input value={f.school_no} onChange={(e) => setF({ ...f, school_no: e.target.value })} required />
        </div>
        <div className="field">
          <label>Üniversite</label>
          <input value={f.university} onChange={(e) => setF({ ...f, university: e.target.value })} required />
        </div>
      </div>
      <label className="row" style={{ gap: 8, cursor: "pointer", fontSize: 14, marginBottom: 10 }}>
        <input type="checkbox" checked={f.is_demo} onChange={(e) => setF({ ...f, is_demo: e.target.checked })}
          style={{ width: 16, height: 16 }} />
        Demo hesabı (tanıtım için; şifresi değiştirilemez, "Demo verisini sil" ile toplu silinir)
      </label>
      <p className="faint" style={{ fontSize: 12, marginTop: 0 }}>
        Geçici bir şifre üretilir ve yalnızca bir kez gösterilir. Gerçek hesaplar ilk girişte kendi şifresini belirler.
      </p>
      {err && <p className="error">{err}</p>}
      <button className="btn btn-primary" disabled={busy}>{busy ? "Oluşturuluyor…" : "Hesabı oluştur"}</button>
    </form>
  );
}

function TempPassword({ data, onClose }: { data: { user: AdminUser; temp_password: string; why: string }; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="panel" style={{ padding: 14, borderLeft: "3px solid var(--gold)" }}>
      <div style={{ fontWeight: 600 }}>{data.why}: {data.user.full_name}</div>
      <div className="muted" style={{ fontSize: 13, margin: "4px 0 8px" }}>
        Giriş: {data.user.university} · {data.user.school_no}. Geçici şifre <b>yalnızca şimdi</b> gösteriliyor;
        kişiye yüz yüze ya da güvenli bir kanaldan ilet.
        {data.user.must_change_password ? " İlk girişte kendi şifresini belirleyecek." : ""}
      </div>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <code style={{ fontSize: 18, letterSpacing: 1 }}>{data.temp_password}</code>
        <button className="btn btn-sm" onClick={() => {
          navigator.clipboard?.writeText(data.temp_password).then(() => setCopied(true)).catch(() => {});
        }}>{copied ? "Kopyalandı" : "Kopyala"}</button>
        <button className="btn btn-sm btn-primary" onClick={onClose}>Tamam</button>
      </div>
    </div>
  );
}

/* ---------------- Güvenlik kayıtları ---------------- */
function Events({ user, onClearUser }: { user: AdminUser | null; onClearUser: () => void }) {
  const [only, setOnly] = useState<"" | "fail">("");
  const [rows, setRows] = useState<SecurityEvent[] | null>(null);
  useEffect(() => {
    const p = new URLSearchParams({ limit: "200" });
    if (only) p.set("only", only);
    if (user) p.set("user_id", user.id);
    setRows(null);
    api<SecurityEvent[]>(`/admin/events?${p}`).then(setRows).catch(() => setRows([]));
  }, [only, user]);

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <div className="seg">
          <button className={only === "" ? "on" : ""} onClick={() => setOnly("")}>Tümü</button>
          <button className={only === "fail" ? "on" : ""} onClick={() => setOnly("fail")}>Yalnızca şüpheli</button>
        </div>
        {user && (
          <span className="chip">
            {user.full_name}{" "}
            <button className="btn btn-ghost btn-sm" style={{ padding: "0 4px" }} onClick={onClearUser} aria-label="Filtreyi kaldır">×</button>
          </span>
        )}
      </div>
      {!rows ? (
        <span className="faint">Yükleniyor…</span>
      ) : rows.length === 0 ? (
        <span className="faint">Kayıt yok.</span>
      ) : (
        rows.map((e) => (
          <div key={e.id} className="panel" style={{ padding: "8px 12px" }}>
            <div className="row between" style={{ gap: 8, flexWrap: "wrap" }}>
              <span className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                <span className={isBadEvent(e.event) ? "chip chip-danger" : "chip"}>{eventLabel(e.event)}</span>
                <b style={{ fontSize: 13.5 }}>{e.user_name ?? (e.user_id ? "—" : "")}</b>
                {e.actor_name && <span className="muted" style={{ fontSize: 12.5 }}>işlemi yapan: {e.actor_name}</span>}
              </span>
              <span className="faint" style={{ fontSize: 12 }}>{formatDate(e.created_at)}</span>
            </div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
              {e.detail ? `${e.detail} · ` : ""}
              {e.user_agent || e.ip ? `${deviceLabel(e.user_agent)}${e.ip ? ` · ${e.ip}` : ""}` : ""}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
