import { useAuth } from "../auth/AuthContext";
import { Wordmark } from "../components/Brand";
import { ChangePasswordForm } from "../components/security/SecurityParts";

/** Yöneticinin verdiği geçici şifreyle girildiğinde: devam etmeden önce yeni şifre. */
export function ForcePasswordChange() {
  const { user, applySession, logout } = useAuth();
  return (
    <div className="container" style={{ maxWidth: 440, paddingTop: 56 }}>
      <div style={{ marginBottom: 24 }}>
        <Wordmark size={26} />
      </div>
      <div className="card">
        <h1 style={{ fontSize: 22 }}>
          Yeni şifreni <span className="accent">belirle</span>
        </h1>
        <p className="muted" style={{ marginTop: -6 }}>
          {user?.full_name ? `${user.full_name}, h` : "H"}esabına yönetici tarafından verilen geçici şifreyle
          girdin. Devam etmeden önce yalnızca senin bildiğin bir şifre belirle. Mevcut şifre alanına geçici
          şifreyi yaz.
        </p>
        <ChangePasswordForm onDone={applySession} submitLabel="Kaydet ve devam et" />
        <button
          className="btn btn-ghost btn-sm"
          style={{ marginTop: 10 }}
          onClick={async () => {
            await logout();
            window.location.href = "/giris";
          }}
        >
          Çıkış yap
        </button>
      </div>
    </div>
  );
}
