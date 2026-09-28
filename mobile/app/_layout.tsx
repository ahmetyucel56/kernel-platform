import { useEffect, useState } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useFonts } from "expo-font";
import { BricolageGrotesque_700Bold } from "@expo-google-fonts/bricolage-grotesque/700Bold";
import { BricolageGrotesque_800ExtraBold } from "@expo-google-fonts/bricolage-grotesque/800ExtraBold";
import { Sora_600SemiBold } from "@expo-google-fonts/sora/600SemiBold";
import { Sora_700Bold } from "@expo-google-fonts/sora/700Bold";
import { Fraunces_500Medium_Italic } from "@expo-google-fonts/fraunces/500Medium_Italic";
import { AuthProvider, introSeen, useAuth } from "../src/auth";
import { Loader } from "../src/ui";
import { colors } from "../src/theme";
import { ThemeProvider, useThemeMode } from "../src/themeMode";

function Gate() {
  const { user, loading } = useAuth();
  const { mode } = useThemeMode();
  const segments = useSegments();
  const router = useRouter();
  const [seenIntro, setSeenIntro] = useState<boolean | null>(null);

  useEffect(() => {
    introSeen().then(setSeenIntro);
  }, []);

  useEffect(() => {
    if (loading || seenIntro === null) return;
    const inAuth = segments[0] === "login" || segments[0] === "intro";
    // Giriş yoksa: ilk açılışta tanıtım, sonra login. Giriş varsa login/tanıtımdan tabs'a.
    // Diğer authenticated rotalar (ör. /submission/[id]) olduğu gibi kalır.
    const onChangePw = segments[0] === "change-password";
    const isPublic = segments[0] === "aydinlatma"; // KVKK metni girişsiz de okunur
    if (!user && !inAuth && !isPublic) router.replace(seenIntro ? "/login" : "/intro");
    // Geçici şifreyle girildiyse önce yeni şifre (sunucu da diğer istekleri reddeder)
    else if (user?.must_change_password && !onChangePw) router.replace("/change-password");
    else if (user && !user.must_change_password && (inAuth || onChangePw)) router.replace("/(tabs)");
  }, [user, loading, segments, seenIntro]);

  if (loading || seenIntro === null) return <Loader />;

  return (
    <>
      <StatusBar style={mode === "light" ? "dark" : "light"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
          animation: "fade",
        }}
      />
    </>
  );
}

export default function RootLayout() {
  // Web ile aynı marka yazı tipleri. Yüklenemese de uygulama sistem fontuyla açılır.
  const [fontsLoaded, fontError] = useFonts({
    BricolageGrotesque_700Bold,
    BricolageGrotesque_800ExtraBold,
    Sora_600SemiBold,
    Sora_700Bold,
    Fraunces_500Medium_Italic,
  });

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <ThemeProvider>{fontsLoaded || fontError ? <Gate /> : <Loader />}</ThemeProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
