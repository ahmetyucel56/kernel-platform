import { Redirect } from "expo-router";
import { useAuth } from "../src/auth";
import { Loader } from "../src/ui";

export default function Index() {
  const { user, loading } = useAuth();
  if (loading) return <Loader />;
  // Giriş yoksa _layout'taki Gate ilk açılışta tanıtıma, sonra login'e yönlendirir.
  return user ? <Redirect href="/(tabs)" /> : <Loader />;
}
