import { Tabs } from "expo-router";
import type { ColorValue } from "react-native";
import { useAuth } from "../../src/auth";
import { colors, fonts } from "../../src/theme";
import { Icon, type IconName } from "../../src/ui";

function tabIcon(name: IconName) {
  return ({ color }: { color: ColorValue }) => <Icon name={name} size={22} color={color as string} />;
}

export default function TabsLayout() {
  const { user } = useAuth();
  const isStudent = user?.role === "student";
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: colors.bg2, borderTopColor: colors.line },
        tabBarActiveTintColor: colors.gold,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontFamily: fonts.ui, fontSize: 11 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Panom", tabBarIcon: tabIcon("grid") }} />
      <Tabs.Screen
        name="assignments"
        options={{ title: isStudent ? "Ödevlerim" : "Ödevler", tabBarIcon: tabIcon("file-text") }}
      />
      <Tabs.Screen name="community" options={{ title: "Topluluk", tabBarIcon: tabIcon("users") }} />
      <Tabs.Screen name="profile" options={{ title: "Profil", tabBarIcon: tabIcon("user") }} />
    </Tabs>
  );
}
