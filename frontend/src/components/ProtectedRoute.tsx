import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import type { Role } from "../api/types";
import type { ReactNode } from "react";

export function ProtectedRoute({
  children,
  roles,
}: {
  children: ReactNode;
  roles?: Role[];
}) {
  const { user, loading } = useAuth();
  if (loading)
    return (
      <div className="container" style={{ padding: 40 }}>
        <span className="muted">Yükleniyor…</span>
      </div>
    );
  if (!user) return <Navigate to="/giris" replace />;
  if (roles && !roles.includes(user.role))
    return <Navigate to="/" replace />;
  return <>{children}</>;
}
