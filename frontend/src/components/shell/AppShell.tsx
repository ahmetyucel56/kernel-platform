import { NavLink } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "../../auth/AuthContext";
import { ThemeToggle } from "../ThemeToggle";
import { NotificationBell } from "./NotificationBell";
import { BRAND_NAME } from "../../config";

const roleLabel: Record<string, string> = {
  student: "Öğrenci",
  academician: "Akademisyen",
  admin: "Yönetici",
};

type NavItem = { to: string; label: string; icon: ReactNode; soon?: boolean };

function navFor(role: string): NavItem[] {
  const panom: NavItem = { to: "/panel", label: "Panom", icon: <IconGrid /> };
  const topluluk: NavItem = { to: "/topluluk", label: "Topluluk", icon: <IconUsers /> };
  const profil: NavItem = { to: "/profil", label: "Profil", icon: <IconUser /> };
  if (role === "student") {
    return [panom, { to: "/odevlerim", label: "Ödevlerim", icon: <IconList /> }, topluluk, profil];
  }
  if (role === "admin") {
    return [panom, { to: "/yonetim", label: "Yönetim", icon: <IconShield /> }, topluluk, profil];
  }
  return [panom, topluluk, profil];
}

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const items = navFor(user?.role ?? "student");

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: 22,
              letterSpacing: "-0.03em",
            }}
          >
            {BRAND_NAME}
            <span style={{ color: "var(--gold)" }}>.</span>
          </span>
        </div>

        {items.map((it) =>
          it.soon ? (
            <span key={it.to} className="nav-link disabled">
              {it.icon}
              <span>{it.label}</span>
              <span className="tag" style={{ marginLeft: "auto", fontSize: 10, padding: "1px 7px" }}>
                YAKINDA
              </span>
            </span>
          ) : (
            <NavLink
              key={it.to}
              to={it.to}
              className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
            >
              {it.icon}
              <span>{it.label}</span>
            </NavLink>
          )
        )}

        <div className="sidebar-spacer" />

        {user && (
          <div className="sidebar-user">
            <div className="avatar">{initials(user.full_name)}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 14 }}>
                {user.full_name}
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                {user.is_founder ? "Kurucu" : roleLabel[user.role] ?? user.role}
              </div>
            </div>
          </div>
        )}
      </aside>

      <div className="shell-main">
        <div className="shell-topbar">
          <NotificationBell />
          <ThemeToggle />
          <LogoutButton />
        </div>
        <div className="shell-content">{children}</div>
      </div>
    </div>
  );
}

function LogoutButton() {
  const { logout } = useAuth();
  return (
    <button
      className="btn btn-ghost icon-btn"
      title="Çıkış"
      aria-label="Çıkış"
      onClick={async () => {
        await logout();
        window.location.href = "/giris";
      }}
    >
      <IconLogout />
    </button>
  );
}

/* --- Basit çizgi ikonlar --- */
const S = { width: 18, height: 18, fill: "none", stroke: "currentColor", strokeWidth: 1.7 };
function IconGrid() {
  return (
    <svg viewBox="0 0 24 24" {...S}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
  );
}
function IconList() {
  return (
    <svg viewBox="0 0 24 24" {...S}><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></svg>
  );
}
function IconUsers() {
  return (
    <svg viewBox="0 0 24 24" {...S}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /></svg>
  );
}
function IconUser() {
  return (
    <svg viewBox="0 0 24 24" {...S}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
  );
}
function IconShield() {
  return (
    <svg viewBox="0 0 24 24" {...S}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
  );
}
function IconLogout() {
  return (
    <svg viewBox="0 0 24 24" {...S}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
  );
}
