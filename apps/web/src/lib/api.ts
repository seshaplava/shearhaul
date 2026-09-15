const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000/v1";

const LEGACY_TOKEN_KEY = "sharehaul_web_token";
const ROLE_KEY = "sharehaul_web_role";

export type WebRole = "SHIPPER" | "DRIVER";

function tokenKey(role: WebRole) {
  return `sharehaul_web_token_${role}`;
}

export function getApiBase() {
  return API_BASE;
}

export function getRole(): WebRole | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ROLE_KEY) as WebRole | null;
}

export function setActiveRole(role: WebRole) {
  if (typeof window === "undefined") return;
  localStorage.setItem(ROLE_KEY, role);
}

export function getTokenFor(role: WebRole): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(tokenKey(role));
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  const role = getRole();
  if (role) {
    const scoped = getTokenFor(role);
    if (scoped) return scoped;
  }
  return localStorage.getItem(LEGACY_TOKEN_KEY);
}

export function saveSession(token: string, role: WebRole) {
  localStorage.setItem(tokenKey(role), token);
  localStorage.setItem(LEGACY_TOKEN_KEY, token);
  localStorage.setItem(ROLE_KEY, role);
}

export function clearSession(role?: WebRole) {
  const r = role ?? getRole();
  if (r) localStorage.removeItem(tokenKey(r));
  if (!role) {
    localStorage.removeItem(LEGACY_TOKEN_KEY);
    localStorage.removeItem(ROLE_KEY);
  }
}

export async function api<T = unknown>(
  path: string,
  options: RequestInit = {},
  role?: WebRole,
): Promise<T> {
  const token = role ? getTokenFor(role) : getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const msg =
      typeof body?.message === "string"
        ? body.message
        : Array.isArray(body?.message)
          ? body.message.join(", ")
          : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body as T;
}
