import { useEffect, useState } from "react";

/**
 * Path-based routing (mobile-first): every screen is a real /path so links
 * can be shared and refresh/deep-links work (the Worker serves index.html
 * for all app paths). Navigation uses the History API — no page reloads.
 */

export type RouteName =
  | "home"
  | "login"
  | "register"
  | "forgot"
  | "reset"
  | "profile"
  | "analytics"
  | "leaderboard"
  | "subscribe"
  | "friends";

export const PATHS: Record<RouteName, string> = {
  home: "/",
  login: "/login",
  register: "/register",
  forgot: "/forgot-password",
  reset: "/reset-password",
  profile: "/profile",
  analytics: "/analytics",
  leaderboard: "/leaderboard",
  subscribe: "/subscribe",
  friends: "/friends",
};

export function parseRoute(pathname: string): RouteName {
  const path = pathname.replace(/\/+$/, "") || "/";
  switch (path) {
    case "/login": return "login";
    case "/register": return "register";
    case "/forgot-password": return "forgot";
    case "/reset-password": return "reset";
    case "/profile": return "profile";
    case "/analytics": return "analytics";
    case "/leaderboard": return "leaderboard";
    case "/subscribe": return "subscribe";
    case "/friends": return "friends";
    case "/":
    default: return "home";
  }
}

/** Navigate to a path without a full page reload. */
export function navigate(to: string): void {
  if (window.location.pathname + window.location.search === to) return;
  window.history.pushState({}, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** Like navigate, but replaces the current history entry (for redirects). */
export function navigateReplace(to: string): void {
  if (window.location.pathname + window.location.search === to) return;
  window.history.replaceState({}, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function currentQuery(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

/** Current route + query string, updated on back/forward/navigate. */
export function useRoute(): { route: RouteName; query: URLSearchParams } {
  const [location, setLocation] = useState(() => window.location.pathname + window.location.search);

  useEffect(() => {
    const onChange = () => setLocation(window.location.pathname + window.location.search);
    window.addEventListener("popstate", onChange);
    return () => window.removeEventListener("popstate", onChange);
  }, []);

  const qIndex = location.indexOf("?");
  const pathname = qIndex === -1 ? location : location.slice(0, qIndex);
  const search = qIndex === -1 ? "" : location.slice(qIndex);
  return { route: parseRoute(pathname), query: new URLSearchParams(search) };
}
