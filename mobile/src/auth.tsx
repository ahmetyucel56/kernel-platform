import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { api, getToken, onSessionExpired, setToken, type TokenResponse, type User } from "./api";

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
  /** Tanıtım: "Hoca/Öğrenci olarak dene" (yalnızca sunucu demo açıkken). */
  loginDemo: (role: DemoRole) => Promise<void>;
  /** Şifre değişimi gibi işlemlerin döndürdüğü yeni oturumu uygula. */
  applySession: (res: TokenResponse) => Promise<void>;
  refreshUser: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  // "Beni hatırla" tercihi: şifre değişiminden dönen yeni oturum da aynı yerde saklansın
  const [remembered, setRemembered] = useState(true);

  useEffect(() => {
    onSessionExpired(() => setUser(null));
    return () => onSessionExpired(null);
  }, []);

  useEffect(() => {
    (async () => {
      const t = await getToken();
      if (!t) {
        setLoading(false);
        return;
      }
      try {
        const me = await api<User>("/auth/me");
        setUser(me);
      } catch {
        await setToken(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function finish(res: TokenResponse, remember: boolean): Promise<LoginResult> {
    if (res.mfa_required && res.mfa_token) return { done: false, mfaToken: res.mfa_token };
    await setToken(res.access_token, remember);
    setRemembered(remember);
    setUser(res.user);
    return { done: true };
  }

  async function loginSchool(university: string, schoolNo: string, password: string, remember = true) {
    const res = await api<TokenResponse>("/auth/login-school", {
      method: "POST",
      auth: false,
      body: { university, school_no: schoolNo, password },
    });
    return finish(res, remember);
  }

  async function loginEmail(email: string, password: string, remember = true) {
    const res = await api<TokenResponse>("/auth/login", {
      method: "POST",
      auth: false,
      body: { email, password },
    });
    return finish(res, remember);
  }

  async function verify2fa(mfaToken: string, code: string, remember = true) {
    const res = await api<TokenResponse>("/auth/login/2fa", {
      method: "POST",
      auth: false,
      body: { mfa_token: mfaToken, code },
    });
    await finish(res, remember);
  }

  async function loginDemo(role: DemoRole) {
    const res = await api<TokenResponse>("/auth/demo-login", {
      method: "POST",
      auth: false,
      body: { role },
    });
    await finish(res, false); // demo oturumu kalıcı değil
  }

  async function applySession(res: TokenResponse) {
    await finish(res, remembered);
  }

  async function refreshUser() {
    setUser(await api<User>("/auth/me"));
  }

  async function logout() {
    try {
      await api("/auth/logout", { method: "POST" }); // bu cihazın oturumunu sunucuda da kapat
    } catch {
      /* sunucuya ulaşılamasa da yerelde çık */
    }
    await setToken(null);
    setUser(null);
  }

  const value = useMemo(
    () => ({ user, loading, loginSchool, loginEmail, verify2fa, loginDemo, applySession, refreshUser, logout }),
    [user, loading, remembered]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/** Sunucu demo girişine izin veriyor mu? (ulaşılamazsa: hayır) */
export function useDemoEnabled(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    api<{ enabled: boolean }>("/auth/demo", { auth: false })
      .then((r) => setOn(!!r.enabled))
      .catch(() => setOn(false));
  }, []);
  return on;
}

/* --- İlk açılış tanıtımı bir kez gösterilir --- */
const INTRO_KEY = "kernel_intro_seen";

export async function introSeen(): Promise<boolean> {
  try {
    const v = Platform.OS === "web" ? globalThis.localStorage?.getItem(INTRO_KEY) : await SecureStore.getItemAsync(INTRO_KEY);
    return v === "1";
  } catch {
    return true; // okunamazsa tanıtımı zorla gösterme
  }
}

export async function markIntroSeen(): Promise<void> {
  try {
    if (Platform.OS === "web") globalThis.localStorage?.setItem(INTRO_KEY, "1");
    else await SecureStore.setItemAsync(INTRO_KEY, "1");
  } catch {
    /* yut */
  }
}
