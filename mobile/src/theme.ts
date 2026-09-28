// "Bold Noir" tema token'lari — web'deki theme.css ile ayni palet (koyu + acik).
// `colors` degistirilebilir bir nesnedir: tema degisince applyMode() degerleri
// gunceller ve ThemeProvider agaci yeniden kurar (bkz. src/themeMode.tsx).

export type Mode = "dark" | "light";

const dark = {
  bg: "#0c0b0d",
  bg2: "#141216",
  bg3: "#1b191f",
  ink: "#f3efe7",
  muted: "#9c968c",
  faint: "#6f6a63",
  line: "rgba(255,255,255,0.10)",
  line2: "rgba(255,255,255,0.16)",
  gold: "#d8b273",
  goldDim: "#a98a52",
  goldBg: "rgba(216,178,115,0.12)",
  onGold: "#1a1408",
  blue: "#3b5bff",
  blueSoft: "#5f79ff",
  blueBg: "rgba(95,121,255,0.12)",
  danger: "#ff7b7b",
  dangerBg: "rgba(255,107,107,0.10)",
  ok: "#4ec9b0",
  okBg: "rgba(78,201,176,0.10)",
  overlay: "rgba(0,0,0,0.6)",
};

const light: typeof dark = {
  bg: "#f6f3ec",
  bg2: "#ffffff",
  bg3: "#efece1",
  ink: "#1b1913",
  muted: "#5c574d",
  faint: "#8b8578",
  line: "rgba(27,25,19,0.10)",
  line2: "rgba(27,25,19,0.18)",
  gold: "#9c6b1f",
  goldDim: "#7d5518",
  goldBg: "rgba(156,107,31,0.10)",
  onGold: "#ffffff",
  blue: "#3b5bff",
  blueSoft: "#2c40d6",
  blueBg: "rgba(59,91,255,0.08)",
  danger: "#c0392b",
  dangerBg: "rgba(192,57,43,0.07)",
  ok: "#0f7a63",
  okBg: "rgba(15,122,99,0.08)",
  overlay: "rgba(0,0,0,0.45)",
};

export const colors = { ...dark };
export let mode: Mode = "dark";

export function applyMode(m: Mode) {
  mode = m;
  Object.assign(colors, m === "light" ? light : dark);
}

// Kod görüntüleyici her iki temada da koyu kalır (okunabilir sözdizimi renkleri)
export const code = { bg: "#1e1e1e", ink: "#d4d4d4", add: "#4ec9b0", del: "#ff6b6b" };

// Web ile aynı yazı tipleri (src/fonts.ts yükler). Özel yazı tipinde ağırlık
// dosyadan gelir; fontWeight verilmez (Android'de yedek yazı tipine düşer).
export const fonts = {
  display: "BricolageGrotesque_800ExtraBold",
  displayBold: "BricolageGrotesque_700Bold",
  ui: "Sora_600SemiBold",
  uiBold: "Sora_700Bold",
  accent: "Fraunces_500Medium_Italic",
};

export const radius = { sm: 10, md: 14, lg: 18 };
