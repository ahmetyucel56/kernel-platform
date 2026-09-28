/** Fetch tabanli API istemcisi.
 *
 *  Oturum guvenligi: uzun omurlu oturum JavaScript'in OKUYAMADIGI httpOnly bir cerezde
 *  durur (yalnizca /api/auth yoluna gider; Vercel bu yolu backend'e aktarir). Buradaki
 *  erisim token'i 15 dakikaliktir ve yalnizca BELLEKTE tutulur (localStorage'a yazilmaz):
 *  sayfa yenilenince /auth/refresh ile yenisi alinir. */
import { API_BASE_URL, AUTH_BASE_URL } from "../config";
import type { TokenResponse } from "./types";

let accessToken: string | null = null;

// Eski surum token'i localStorage'da tutuyordu: kalintiyi temizle.
try {
  localStorage.removeItem("kernel_token");
  sessionStorage.removeItem("kernel_token");
} catch {
  /* yut */
}

export function getToken(): string | null {
  return accessToken;
}

export function setToken(token: string | null): void {
  accessToken = token;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const FIELD_LABEL: Record<string, string> = {
  email: "e-posta",
  password: "şifre",
  new_password: "yeni şifre",
  full_name: "ad soyad",
  school_no: "numara",
  code: "kod",
  setup_token: "kurulum anahtarı",
};

/** FastAPI doğrulama hatası (422) → okunur Türkçe mesaj. */
function validationMessage(detail: unknown): string | null {
  if (!Array.isArray(detail) || !detail.length) return null;
  const loc = (detail[0] as { loc?: unknown[] })?.loc ?? [];
  const field = String(loc[loc.length - 1] ?? "");
  return `Geçersiz bilgi: ${FIELD_LABEL[field] ?? field}. Lütfen kontrol et.`;
}

async function errorFrom(res: Response): Promise<ApiError> {
  let detail = `Hata (${res.status})`;
  try {
    const data = await res.json();
    if (data?.detail) detail = typeof data.detail === "string" ? data.detail : validationMessage(data.detail) ?? detail;
  } catch {
    /* govde yok */
  }
  return new ApiError(res.status, detail);
}

/** Oturum uç noktaları (giriş, 2FA, yenileme, çıkış): httpOnly çerez için aynı siteden (/api). */
export async function authApi<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${AUTH_BASE_URL}${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-Kernel-Client": "web" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw await errorFrom(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// Aynı anda birden çok istek 401 alırsa tek bir yenileme yapılır.
let refreshing: Promise<TokenResponse | null> | null = null;

/** Çerezdeki oturumdan yeni erişim token'ı al (yoksa null). */
export function refreshSession(): Promise<TokenResponse | null> {
  if (!refreshing) {
    refreshing = authApi<TokenResponse>("/auth/refresh")
      .then((r) => {
        setToken(r.access_token);
        return r;
      })
      .catch(() => {
        setToken(null);
        return null;
      })
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

function sessionEnded(): void {
  setToken(null);
  if (!window.location.pathname.startsWith("/giris")) window.location.href = "/giris?oturum=bitti";
}

async function send(path: string, init: RequestInit, auth: boolean): Promise<Response> {
  const run = () => {
    const headers = new Headers(init.headers);
    if (auth && accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
    return fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  };
  let res = await run();
  // Erişim token'ı doldu (15 dk) ya da sayfa yeni açıldı: çerezle yenile, bir kez tekrar dene
  if (res.status === 401 && auth) {
    const r = await refreshSession();
    if (r) res = await run();
    else if (path !== "/auth/me") sessionEnded();
  }
  return res;
}

export async function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean } = {}
): Promise<T> {
  const { method = "GET", body, auth = true } = options;
  const res = await send(
    path,
    {
      method,
      headers: { "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    },
    auth
  );
  if (!res.ok) throw await errorFrom(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Multipart dosya yukleme (JSON degil FormData; Content-Type otomatik). */
export async function apiUpload<T = unknown>(path: string, form: FormData): Promise<T> {
  const res = await send(path, { method: "POST", body: form }, true);
  if (!res.ok) throw await errorFrom(res);
  return (await res.json()) as T;
}
