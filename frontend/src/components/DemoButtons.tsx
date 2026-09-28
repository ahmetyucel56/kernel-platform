import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { useAuth, type DemoRole } from "../auth/AuthContext";

/** "Hoca olarak dene / Öğrenci olarak dene" — yalnızca sunucu demo açıksa gösterilir. */
export function DemoButtons({ compact = false }: { compact?: boolean }) {
  const { loginDemo } = useAuth();
  const nav = useNavigate();
  const [busy, setBusy] = useState<DemoRole | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function go(role: DemoRole) {
    setErr(null);
    setBusy(role);
    try {
      await loginDemo(role);
      nav("/panel");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Demo girişi yapılamadı.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <button className="btn btn-gold" onClick={() => go("academician")} disabled={busy !== null}>
          {busy === "academician" ? "Açılıyor…" : "Hoca olarak dene"}
        </button>
        <button className="btn" onClick={() => go("student")} disabled={busy !== null}>
          {busy === "student" ? "Açılıyor…" : "Öğrenci olarak dene"}
        </button>
      </div>
      {!compact && (
        <p className="faint" style={{ fontSize: 12, margin: "8px 0 0" }}>
          Hazır tanıtım sınıfıyla açılır; şifre gerekmez.
        </p>
      )}
      {err && <p className="error">{err}</p>}
    </div>
  );
}
