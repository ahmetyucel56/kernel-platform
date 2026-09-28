import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../src/auth";
import { ChangePasswordForm } from "../src/SecurityParts";
import { Accent, Btn, Card, Muted, Screen } from "../src/ui";
import { colors, fonts } from "../src/theme";

/** Yöneticinin verdiği geçici şifreyle girildiğinde: devam etmeden önce yeni şifre. */
export default function ForcePasswordChange() {
  const { user, applySession, logout } = useAuth();
  const router = useRouter();
  return (
    <Screen>
      <View style={{ marginTop: 30 }}>
        <Card>
          <Text style={{ color: colors.ink, fontSize: 22, fontFamily: fonts.display }}>
            Yeni şifreni <Accent>belirle</Accent>
          </Text>
          <Muted style={{ marginTop: 4, marginBottom: 14 }}>
            {user?.full_name ? `${user.full_name}, h` : "H"}esabına yönetici tarafından verilen geçici şifreyle
            girdin. Devam etmeden önce yalnızca senin bildiğin bir şifre belirle. Mevcut şifre alanına geçici şifreyi
            yaz.
          </Muted>
          <ChangePasswordForm
            submitLabel="Kaydet ve devam et"
            onDone={async (res) => {
              await applySession(res);
              router.replace("/(tabs)");
            }}
          />
        </Card>
        <Btn
          variant="ghost"
          icon="log-out"
          title="Çıkış yap"
          onPress={async () => {
            await logout();
            router.replace("/login");
          }}
        />
      </View>
    </Screen>
  );
}
