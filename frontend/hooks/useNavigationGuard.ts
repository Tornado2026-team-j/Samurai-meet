import { usePathname, useRouter, type Href } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
import { createNavigationGuard, type NavigationGuard } from "../utils/navigationGuard";

export const NAVIGATION_GUARD_TIMEOUT_MS = 1000;

function hrefPathname(href: Href): string | null {
  if (typeof href === "string") return href.split(/[?#]/u, 1)[0] || "/";
  if (href && typeof href === "object" && "pathname" in href) {
    return typeof href.pathname === "string" ? href.pathname : null;
  }
  return null;
}

type NavigationMethod = "push" | "replace";

/**
 * Prevents repeated presses from queuing duplicate routes while the current
 * navigation is being committed. The guard is released when the pathname
 * changes, with a timeout as a safety net for rejected native transitions.
 */
export function useNavigationGuard() {
  const router = useRouter();
  const pathname = usePathname();
  const guardRef = useRef<NavigationGuard | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (guardRef.current === null) guardRef.current = createNavigationGuard();
  const guard = guardRef.current;

  useEffect(() => {
    guard.reset();
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
    return () => {
      guard.reset();
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [guard, pathname]);

  const navigate = useCallback((href: Href, method: NavigationMethod = "push"): boolean => {
    if (hrefPathname(href) === pathname || !guard.begin()) return false;

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      guard.reset();
    }, NAVIGATION_GUARD_TIMEOUT_MS);

    try {
      if (method === "replace") router.replace(href);
      else router.push(href);
      return true;
    } catch (error) {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = null;
      guard.reset();
      throw error;
    }
  }, [guard, pathname, router]);

  const push = useCallback((href: Href) => navigate(href, "push"), [navigate]);
  const replace = useCallback((href: Href) => navigate(href, "replace"), [navigate]);

  return { navigate, push, replace };
}
