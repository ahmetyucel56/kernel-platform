import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Wordmark } from "./Brand";
import { ThemeToggle } from "./ThemeToggle";

const roleLabel: Record<string, string> = {
  student: "Öğrenci",
  academician: "Akademisyen",
  admin: "Yönetici",
};

export function TopBar() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const { pathname } = useLocation();

  return (
    <header
      style={{
        borderBottom: "1px solid var(--line)",
        background: "var(--bg-2)",
        position: "sticky",
        top: 0,
        zIndex: 10,
      }}
    >
      <div className="topbar">
        <Link to="/" style={{ color: "var(--ink)" }}>
          <Wordmark />
        </Link>
        <div className="row" style={{ gap: 8 }}>
          {pathname === "/" &&
            [
              ["yolculuk", "Nasıl çalışır"],
              ["ozellikler", "Özellikler"],
              ["sss", "SSS"],
            ].map(([id, label]) => (
              <button
                key={id}
                className="btn btn-ghost hide-sm"
                style={{ border: 0, padding: "8px 10px", color: "var(--muted)" }}
                onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" })}
              >
                {label}
              </button>
            ))}
          <ThemeToggle />
          {user ? (
            <>
              <span className="tag tag-gold">{roleLabel[user.role] ?? user.role}</span>
              <span className="muted hide-sm" style={{ fontSize: 13 }}>
                {user.full_name}
              </span>
              <button
                className="btn"
                onClick={async () => {
                  await logout();
                  nav("/giris");
                }}
              >
                Çıkış
              </button>
            </>
          ) : (
            <Link className="btn btn-primary" to="/giris">
              Giriş
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
