export type AuthRole = 'admin' | 'ops' | 'dispatch' | 'driver';

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: AuthRole;
  truckPlate?: string;
};

const TOKEN_KEY = 'opticlean.ops.auth.token';
const USER_KEY = 'opticlean.ops.auth.user';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

export function setSession(token: string, user: AuthUser) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function isDriver(user: AuthUser | null | undefined) {
  return user?.role === 'driver';
}

export function isDispatch(user: AuthUser | null | undefined) {
  return user?.role === 'dispatch';
}

/** Bodega en piso (ops) o admin */
export function isWarehouseRole(user: AuthUser | null | undefined) {
  return user?.role === 'ops' || user?.role === 'admin';
}

export function homePathForRole(role: AuthRole) {
  if (role === 'driver') return '/ruta';
  if (role === 'dispatch') return '/despacho';
  return '/';
}
