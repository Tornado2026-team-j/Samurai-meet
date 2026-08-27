import { Redirect, Stack, usePathname, useRouter } from "expo-router";
import { useEffect, useRef, type ReactNode } from "react";
import { View } from "react-native";
import { AuthProvider, useAuth } from "../hooks/useAuth";
import {
  isProtectedRoute,
  shouldRedirectToSignedOutRoot,
  shouldResetSignedOutNavigation,
} from "../services/route-guard";

function AuthRouteGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { status } = useAuth();

  if (status === "loading" && isProtectedRoute(pathname)) {
    return <View style={{ flex: 1, backgroundColor: "#ffffff" }} />;
  }

  if (shouldRedirectToSignedOutRoot(status, pathname)) {
    return <Redirect href="/" />;
  }

  return <>{children}</>;
}

function RootNavigator() {
  const router = useRouter();
  const { status } = useAuth();
  const previousStatus = useRef(status);

  useEffect(() => {
    const shouldReset = shouldResetSignedOutNavigation(previousStatus.current, status);
    previousStatus.current = status;
    if (!shouldReset) return;

    // Keep this reset above individual screens so a screen-level replace
    // cannot unmount the logout cleanup before the old stack is removed.
    router.dismissAll();
    router.replace("/");
  }, [router, status]);

  return (
    <Stack
      initialRouteName="index"
      screenLayout={({ children }) => <AuthRouteGuard>{children}</AuthRouteGuard>}
      screenOptions={{
        animation: "none",
        headerShown: false,
      }}
    />
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootNavigator />
    </AuthProvider>
  );
}
