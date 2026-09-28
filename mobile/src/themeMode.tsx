import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Platform, useColorScheme, View } from "react-native";
import * as SecureStore from "expo-secure-store";
import { applyMode, type Mode } from "./theme";

/** Tema tercihi: sistem / koyu / açık (web'deki tema düğmesinin karşılığı). */
export type ThemePref = "system" | "dark" | "light";
const KEY = "kernel_theme";

async function load(): Promise<ThemePref | null> {
  try {
    const v = Platform.OS === "web" ? globalThis.localStorage?.getItem(KEY) : await SecureStore.getItemAsync(KEY);
    return v === "dark" || v === "light" || v === "system" ? v : null;
  } catch {
    return null;
  }
}

async function save(v: ThemePref) {
  try {
    if (Platform.OS === "web") globalThis.localStorage?.setItem(KEY, v);
    else await SecureStore.setItemAsync(KEY, v);
  } catch {
    /* tercih kaydedilemezse oturum boyunca geçerli kalır */
  }
}

const Ctx = createContext<{ pref: ThemePref; mode: Mode; setPref: (p: ThemePref) => void }>({
  pref: "system",
  mode: "dark",
  setPref: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [pref, setPrefState] = useState<ThemePref>("system");

  useEffect(() => {
    load().then((v) => v && setPrefState(v));
  }, []);

  const mode: Mode = pref === "system" ? (system === "light" ? "light" : "dark") : pref;
  // Renkler, alt ağaç çizilmeden önce güncellenir; key ile ağaç yeniden kurulur
  // (StyleSheet'ler ve ekran bileşenleri yeni renkleri okur).
  applyMode(mode);

  function setPref(p: ThemePref) {
    setPrefState(p);
    save(p);
  }

  return (
    <Ctx.Provider value={{ pref, mode, setPref }}>
      <View key={mode} style={{ flex: 1 }}>
        {children}
      </View>
    </Ctx.Provider>
  );
}

export function useThemeMode() {
  return useContext(Ctx);
}
