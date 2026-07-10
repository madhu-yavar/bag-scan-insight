import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

const DEFAULT_NEXT = "/scan-local";
const AUTH_PARAM_KEYS = [
  "access_token",
  "code",
  "error",
  "error_code",
  "error_description",
  "expires_at",
  "expires_in",
  "refresh_token",
  "token_type",
  "type",
];

type RouteLocation = {
  pathname: string;
  searchStr?: string;
};

export function safeNext(next?: string | null) {
  if (!next) return DEFAULT_NEXT;
  if (!next.startsWith("/") || next.startsWith("//")) return DEFAULT_NEXT;
  return next;
}

export async function requireSignedIn(location: RouteLocation) {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw redirect({
      to: "/auth",
      search: { next: safeNext(`${location.pathname}${location.searchStr ?? ""}`) },
    });
  }
  return data.user;
}

export function readAuthRedirectParams() {
  const params = new URLSearchParams(window.location.search);
  const hash = window.location.hash.replace(/^#/, "");
  const hashQuery = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : hash;
  const hashParams = new URLSearchParams(hashQuery);

  hashParams.forEach((value, key) => {
    if (!params.has(key)) params.set(key, value);
  });

  return params;
}

export function hasAuthRedirectParams(params: URLSearchParams) {
  return AUTH_PARAM_KEYS.some((key) => params.has(key));
}

export async function applyAuthRedirectParams(params: URLSearchParams) {
  const code = params.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return;
  }

  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (accessToken && refreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) throw error;
  }
}

export function clearAuthRedirectParams() {
  const url = new URL(window.location.href);
  AUTH_PARAM_KEYS.forEach((key) => url.searchParams.delete(key));
  window.history.replaceState(null, document.title, `${url.pathname}${url.search}`);
}

export function buildCallbackUrlForCurrentAuthParams(next?: string) {
  const params = readAuthRedirectParams();
  const url = new URL("/auth/callback", window.location.origin);
  url.searchParams.set("next", safeNext(next));
  params.forEach((value, key) => {
    if (AUTH_PARAM_KEYS.includes(key)) url.searchParams.set(key, value);
  });
  if (window.location.hash) url.hash = window.location.hash;
  return `${url.pathname}${url.search}${url.hash}`;
}
