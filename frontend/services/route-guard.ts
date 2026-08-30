export type AuthRouteStatus = "loading" | "signed_out" | "pre_auth" | "signed_in";

const PROTECTED_ROUTE_ROOTS = [
  "/chat",
  "/foreigner",
  "/japanese",
  "/profile",
  "/recruitments",
  "/tabs",
] as const;

function normalizePathname(pathname: string): string {
  const withoutQuery = pathname.split(/[?#]/, 1)[0] ?? "/";
  const withLeadingSlash = withoutQuery.startsWith("/")
    ? withoutQuery
    : `/${withoutQuery}`;
  if (withLeadingSlash.length === 1) return "/";
  return withLeadingSlash.replace(/\/+$/, "");
}

export function isProtectedRoute(pathname: string): boolean {
  const normalized = normalizePathname(pathname);
  return PROTECTED_ROUTE_ROOTS.some(
    (root) => normalized === root || normalized.startsWith(`${root}/`),
  );
}

export function shouldRedirectToSignedOutRoot(
  status: AuthRouteStatus,
  pathname: string,
): boolean {
  return status !== "loading" && status !== "signed_in" && isProtectedRoute(pathname);
}

export function shouldResetSignedOutNavigation(
  previousStatus: AuthRouteStatus,
  status: AuthRouteStatus,
): boolean {
  return (
    status === "signed_out"
    && (previousStatus === "signed_in" || previousStatus === "pre_auth")
  );
}
