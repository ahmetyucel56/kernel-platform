/** Marka ve ortam ayarlari — tek kaynak (spec Bolum 8.5). */
export const BRAND_NAME = import.meta.env.VITE_BRAND_NAME ?? "Kernel";
export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
/** Oturum uç noktaları aynı siteden çağrılır (httpOnly çerez birinci taraf olsun):
 *  canlıda Vercel /api/* → backend, yerelde Vite proxy. */
/** Kurucu giriş sayfasının adresi koda yazılmaz (depo herkese açık): Vercel'de
 *  VITE_ADMIN_LOGIN_PATH ile verilir (ör. "/xyz-giris"). Tanımlı değilse sayfa hiç yoktur. */
export const ADMIN_LOGIN_PATH: string | undefined = import.meta.env.VITE_ADMIN_LOGIN_PATH || undefined;
export const AUTH_BASE_URL = import.meta.env.VITE_AUTH_BASE_URL ?? "/api";
