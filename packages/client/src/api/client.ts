import axios from "axios";
import toast from "react-hot-toast";
import type { ApiResponse } from "@emp-payroll/shared";

const API_BASE = import.meta.env.VITE_API_URL || "/api/v1";

export const api = axios.create({
  baseURL: API_BASE,
  headers: { "Content-Type": "application/json" },
});

// Attach JWT token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Cascade guard: when many in-flight requests all 401 at once because the
// access token just expired, we only want to clear storage / show one
// toast / do one redirect — not N. The full page reload from
// location.replace() resets every other in-flight axios request anyway.
let forceLogoutInFlight = false;

// Endpoints whose own 401 means "wrong credentials" or "token exchange
// rejected" — surfacing the toast + redirect for these would be wrong.
// The login page already shows its own inline error.
const AUTH_ENDPOINT_PARTS = [
  "/auth/login",
  "/auth/sso",
  "/auth/forgot-password",
  "/auth/reset-password",
];
const isAuthEndpoint = (url: string) => AUTH_ENDPOINT_PARTS.some((p) => url.includes(p));

/**
 * Hard logout used when the access token is rejected by the server (expired,
 * revoked, or the user was deactivated). Clears the localStorage tokens,
 * surfaces a one-shot toast, and redirects to /login?session=expired so the
 * login page can render an explanation instead of an empty form.
 *
 * Idempotent within one tab: subsequent calls during the same expiry
 * cascade are no-ops. Suppressed entirely on public auth routes (no point
 * showing "session expired" to someone who's actively typing into the
 * login form).
 */
function forceLogout() {
  if (forceLogoutInFlight) return;
  forceLogoutInFlight = true;

  localStorage.removeItem("access_token");
  localStorage.removeItem("refresh_token");
  localStorage.removeItem("user");
  localStorage.removeItem("token"); // legacy mock token

  const path = window.location.pathname;
  const onAuthRoute =
    path === "/login" || path === "/forgot-password" || path === "/reset-password";

  if (onAuthRoute) {
    forceLogoutInFlight = false;
    return;
  }

  try {
    toast.error("Your session has expired. Please sign in again.");
  } catch {
    /* if the toaster isn't mounted yet, the redirect is the authoritative
       signal — keep going. */
  }

  // location.replace so the back button doesn't return to a now-broken page.
  // Full reload also nukes in-flight axios requests + react-query cache so
  // no stale data leaks into the next session.
  window.location.replace("/login?session=expired");
}

// Handle 401 — clear session, toast, and redirect to login. SSO exchange
// failures are skipped (the SSO landing handles its own error UI).
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const requestUrl = error.config?.url || "";
    if (error.response?.status === 401 && !isAuthEndpoint(requestUrl)) {
      forceLogout();
    }
    return Promise.reject(error);
  },
);

// ---------------------------------------------------------------------------
// Typed API helpers
// ---------------------------------------------------------------------------

export async function apiGet<T>(
  url: string,
  params?: Record<string, any>,
): Promise<ApiResponse<T>> {
  const { data } = await api.get<ApiResponse<T>>(url, { params });
  return data;
}

export async function apiPost<T>(url: string, body?: any): Promise<ApiResponse<T>> {
  const { data } = await api.post<ApiResponse<T>>(url, body);
  return data;
}

export async function apiPut<T>(url: string, body?: any): Promise<ApiResponse<T>> {
  const { data } = await api.put<ApiResponse<T>>(url, body);
  return data;
}

export async function apiDelete<T>(url: string): Promise<ApiResponse<T>> {
  const { data } = await api.delete<ApiResponse<T>>(url);
  return data;
}
