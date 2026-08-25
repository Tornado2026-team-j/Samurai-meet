import { Stack } from "expo-router";
import { AuthProvider } from "../hooks/useAuth";

export default function RootLayout() {
  return (
    <AuthProvider>
      <Stack
        initialRouteName="index"
        screenOptions={{
          animation: "none",
          headerShown: false,
        }}
      />
    </AuthProvider>
  );
}
