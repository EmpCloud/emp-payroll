// Auth helpers — store/retrieve tokens and user info

export interface AuthUser {
  id: string;
  orgId: string;
  role: string;
  email: string;
  firstName: string;
  lastName: string;
  department: string;
  designation: string;
}

export function saveAuth(data: { user: any; tokens: any }) {
  localStorage.setItem("access_token", data.tokens.accessToken);
  localStorage.setItem("refresh_token", data.tokens.refreshToken);
  localStorage.setItem(
    "user",
    JSON.stringify({
      id: data.user.id,
      orgId: data.user.org_id,
      role: data.user.role,
      email: data.user.email,
      firstName: data.user.first_name,
      lastName: data.user.last_name,
      department: data.user.department,
      designation: data.user.designation,
    })
  );
}

export function getUser(): AuthUser | null {
  const raw = localStorage.getItem("user");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  return localStorage.getItem("access_token");
}

export function isLoggedIn(): boolean {
  return !!getToken();
}

export function logout() {
  localStorage.removeItem("access_token");
  localStorage.removeItem("refresh_token");
  localStorage.removeItem("user");
  localStorage.removeItem("token"); // old mock token
  window.location.href = "/login";
}
