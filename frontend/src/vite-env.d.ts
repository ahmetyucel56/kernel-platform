/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BRAND_NAME?: string;
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_AUTH_BASE_URL?: string;
  readonly VITE_ADMIN_LOGIN_PATH?: string;
  readonly VITE_SENTRY_DSN?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
