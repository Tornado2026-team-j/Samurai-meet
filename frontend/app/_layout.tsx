import { Redirect, Stack, usePathname, useRouter } from "expo-router";
import { useEffect, useRef, type ReactNode } from "react";
import { View } from "react-native";
import GlobalTabBar from "../components/GlobalTabBar";
import { LoadingSpinner } from "../components/ui";
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
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#ffffff" }}>
        <LoadingSpinner color="#5EC5F5" size={28} speedMs={640} />
      </View>
    );
  }

  if (shouldRedirectToSignedOutRoot(status, pathname)) {
    return <Redirect href="/" />;
  }

  return (
    <View style={{ flex: 1 }}>
      {children}
    </View>
  );
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
    if (router.canDismiss()) {
      router.dismissAll();
    }
    router.replace("/");
  }, [router, status]);

  return (
    <View style={{ flex: 1 }}>
      <Stack
        initialRouteName="index"
        screenLayout={({ children }) => <AuthRouteGuard>{children}</AuthRouteGuard>}
        screenOptions={{
          animation: "none",
          headerShown: false,
        }}
      />
      {status === "signed_in" ? <GlobalTabBar /> : null}
    </View>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootNavigator />
    </AuthProvider>
  );
}
