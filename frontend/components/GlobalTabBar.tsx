import { useEffect, useState } from "react";
import { usePathname } from "expo-router";
import { loadAppMode, type AppMode } from "../services/onboarding";
import GlassTabBar from "./GlassTabBar";

type TabKey = "home" | "chat" | "plans" | "monsters" | "profile";

function activeTabFor(pathname: string): TabKey | null {
  if (pathname === "/japanese" || pathname === "/foreigner") return "home";
  if (pathname === "/chat") return "chat";
  if (pathname === "/plans") return "plans";
  if (pathname === "/monsters") return "monsters";
  if (pathname === "/profile" || pathname === "/account-settings" || pathname === "/theme-settings") return "profile";
  return null;
}

export default function GlobalTabBar() {
  const pathname = usePathname();
  const [appMode, setAppMode] = useState<AppMode>("local");
  const activeTab = activeTabFor(pathname);

  useEffect(() => {
    let active = true;
    void loadAppMode().then((mode) => {
      if (active && mode) setAppMode(mode);
    });
    return () => {
      active = false;
    };
  }, [pathname]);

  if (!activeTab) return null;
  return <GlassTabBar activeTab={activeTab} appMode={appMode} plansHref="/plans" />;
}
