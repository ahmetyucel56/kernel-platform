import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, authApi, refreshSession, setToken } from "../api/client";
import type { TokenResponse, User } from "../api/types";

export type DemoRole = "academician" | "student";

/** Giriş sonucu: tamamlandı ya da iki adımlı doğrulama kodu bekleniyor. */
export type LoginResult = { done: true } | { done: false; mfaToken: string };

interface AuthState {
  user: User | null;
  loading: boolean;
  loginSchool: (
    university: string,
    schoolNo: string,
    password: string,
    remember?: boolean
  ) => Promise<LoginResult>;
  /** Kurucu/yönetici: e-posta + şifre. */
  loginEmail: (email: string, password: string, remember?: boolean) => Promise<LoginResult>;
  /** İkinci adım: doğrulayıcı uygulamadaki kod ya da yedek kod. */
  verify2fa: (mfaToken: string, code: string, remember?: boolean) => Promise<void>;
  /** Tanıtım: "Hoca/Öğrenci olarak dene" (yalnızca demo açıkken çalışır). */
  loginDemo: (role: DemoRole) => Promise<void>;
  /** Şifre değişimi gibi işlemlerin döndürdüğü yeni erişim token'ını uygula. */
  applySession: (res: TokenResponse) => void;
  refreshUser: () => Promise<void>;
  /** Bu cihazdaki oturumu sunucuda kapatır ve çerezi siler. */
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Sayfa açılışı: token bellekte tutulduğu için httpOnly çerezdeki oturumdan yenisi alınır.
    refreshSession()
      .then((r) => setUser(r?.user ?? null))
      .finally(() => setLoading(false));
  }, []);

  function finish(res: TokenResponse): LoginResult {
    if (res.mfa_required && res.mfa_token) return { done: false, mfaToken: res.mfa_token };
    setToken(res.access_token);
    setUser(res.user);
    return { done: true };
  }

  async function loginSchool(university: string, schoolNo: string, password: string, remember = true) {
    return finish(
      await authApi<TokenResponse>("/auth/login-school", { university, school_no: schoolNo, password, remember })
    );
  }

  async function loginEmail(email: string, password: string, remember = true) {
    return finish(await authApi<TokenResponse>("/auth/login", { email, password, remember }));
  }

  async function verify2fa(mfaToken: string, code: string, remember = true) {
    finish(await authApi<TokenResponse>("/auth/login/2fa", { mfa_token: mfaToken, code, remember }));
  }

  async function loginDemo(role: DemoRole) {
    // Demo oturumu kalıcı değil: tarayıcı kapanınca biter (sunucu tarafında belirlenir)
    finish(await authApi<TokenResponse>("/auth/demo-login", { role }));
  }

  function applySession(res: TokenResponse) {
    finish(res);
  }

  async function refreshUser() {
    setUser(await api<User>("/auth/me"));
  }

  async function logout() {
    try {
      await authApi("/auth/logout");
    } catch {
      /* sunucuya ulaşılamasa da yerelde çık */
    }
    setToken(null);
    setUser(null);
  }

  const value = useMemo(
    () => ({ user, loading, loginSchool, loginEmail, verify2fa, loginDemo, applySession, refreshUser, logout }),
    [user, loading]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/** Sunucu demo girişine izin veriyor mu? (hata olursa: hayır) */
export function useDemoEnabled(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    api<{ enabled: boolean }>("/auth/demo", { auth: false })
      .then((r) => setOn(!!r.enabled))
      .catch(() => setOn(false));
  }, []);
  return on;
}
