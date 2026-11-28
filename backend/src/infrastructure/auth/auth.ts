import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextFunction, Request, Response } from 'express';
import { permissionsForRole } from './permissions.js';

/** admin | ops=bodega | dispatch=despacho | driver=conductor */
export type AuthRole = 'admin' | 'ops' | 'dispatch' | 'driver';

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: AuthRole;
  /** Empresa (tenant) para menú y módulos */
  companyId: string;
  /** Placa asignada al conductor */
  truckPlate?: string;
  passwordHash: string;
  /** false = no puede iniciar sesión */
  active?: boolean;
  /** Administra la plataforma (todas las empresas). Nunca se concede por registro. */
  platformAdmin?: boolean;
};

export type PublicUser = {
  id: string;
  email: string;
  name: string;
  role: AuthRole;
  companyId: string;
  truckPlate?: string;
  /** Solo presente (true) para administradores de la plataforma. */
  platformAdmin?: boolean;
  /** Permisos efectivos embebidos en el JWT. */
  permissions?: string[];
  /** App emisora del token (multi-app). */
  appId?: string;
};

export type ManagedUser = PublicUser & {
  active: boolean;
  isDemo: boolean;
};

const DEMO_USER_IDS = new Set([
  'U-ADMIN',
  'U-BODEGA',
  'U-OPS',
  'U-DESPACHO',
  'U-DRIVER',
  'U-DEMO-CO',
]);

const ROLES: AuthRole[] = ['admin', 'ops', 'dispatch', 'driver'];

type UsersFile = { version: 1; users: AuthUser[] };

declare global {
  namespace Express {
    interface Request {
      user?: PublicUser;
    }
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Usuarios y empresas no siguen a OPTICLEAN_DATA_DIR (esa es la carpeta del estado): moverlos
// dejaría una instalación existente sin sus cuentas. Se cambian solo con su propia variable.
const DATA_DIR = process.env.OPTICLEAN_AUTH_DATA_DIR?.trim() || path.resolve(__dirname, '../../../../data');
const USERS_PATH = path.join(DATA_DIR, 'users.json');

/** Ruta del archivo de usuarios (para respaldos). */
export const usersFilePath = () => USERS_PATH;

/** Se evalúa al usarse: `.env` se carga después de importar este módulo. */
const isProd = () => process.env.NODE_ENV === 'production';
const INSECURE_SECRETS = new Set(['', 'cambia-este-secreto', 'opticlean-dev-secret-change-me-in-production']);

function resolveSecret() {
  const secret = process.env.OPTICLEAN_JWT_SECRET?.trim() ?? '';
  if (isProd() && (INSECURE_SECRETS.has(secret) || secret.length < 32)) {
    throw new Error(
      '[auth] En producción OPTICLEAN_JWT_SECRET es obligatorio y debe tener al menos 32 caracteres.',
    );
  }
  return secret || 'opticlean-dev-secret-change-me-in-production';
}

let cachedSecret: string | null = null;
const jwtSecret = () => (cachedSecret ??= resolveSecret());
const TOKEN_TTL_SEC = Number(process.env.OPTICLEAN_JWT_TTL ?? 60 * 60 * 12);

function b64url(input: Buffer | string) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function fromB64url(input: string) {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

export function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string) {
  const [algo, saltHex, hashHex] = stored.split('$');
  if (algo !== 'scrypt' || !saltHex || !hashHex) return false;
  const hash = scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(hashHex, 'hex');
  if (hash.length !== expected.length) return false;
  return timingSafeEqual(hash, expected);
}

function signToken(user: PublicUser) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const platformAdmin = Boolean(user.platformAdmin);
  const permissions =
    user.permissions?.length ? user.permissions : permissionsForRole(user.role, platformAdmin);
  const appId = user.appId || 'opticlean';
  const payload = b64url(
    JSON.stringify({
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      roles: [user.role],
      appId,
      aud: appId,
      companyId: user.companyId,
      truckPlate: user.truckPlate,
      pa: platformAdmin ? 1 : undefined,
      platformAdmin: platformAdmin || undefined,
      permissions,
      iss: process.env.AUTH_ISSUER || 'innovamf-auth',
      iat: now,
      exp: now + TOKEN_TTL_SEC,
    }),
  );
  const data = `${header}.${payload}`;
  const sig = createHmac('sha256', jwtSecret()).update(data).digest();
  return `${data}.${b64url(sig)}`;
}

export function verifyToken(token: string): PublicUser | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  const data = `${header}.${payload}`;
  const expected = createHmac('sha256', jwtSecret()).update(data).digest();
  const got = fromB64url(sig);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  try {
    const body = JSON.parse(fromB64url(payload).toString('utf8')) as {
      sub: string;
      email: string;
      name: string;
      role: AuthRole;
      companyId?: string;
      truckPlate?: string;
      pa?: number;
      platformAdmin?: boolean;
      permissions?: string[];
      appId?: string;
      aud?: string;
      exp: number;
    };
    if (!body.exp || body.exp * 1000 < Date.now()) return null;
    const platformAdmin = body.pa === 1 || body.platformAdmin === true;
    const permissions =
      Array.isArray(body.permissions) && body.permissions.length
        ? body.permissions
        : permissionsForRole(body.role, platformAdmin);
    return {
      id: body.sub,
      email: body.email,
      name: body.name,
      role: body.role,
      companyId: body.companyId || 'co-innovamf',
      truckPlate: body.truckPlate,
      appId: body.appId || body.aud || 'opticlean',
      permissions,
      ...(platformAdmin ? { platformAdmin: true } : {}),
    };
  } catch {
    return null;
  }
}

function toPublic(u: AuthUser): PublicUser {
  const platformAdmin = isPlatformAdmin(u);
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    companyId: u.companyId || 'co-innovamf',
    truckPlate: u.truckPlate,
    appId: 'opticlean',
    permissions: permissionsForRole(u.role, platformAdmin),
    ...(platformAdmin ? { platformAdmin: true } : {}),
  };
}

/** El administrador inicial (U-ADMIN) siempre es de plataforma; el resto solo con la bandera explícita. */
function isPlatformAdmin(u: AuthUser) {
  return u.role === 'admin' && (u.id === 'U-ADMIN' || u.platformAdmin === true);
}

/**
 * Regla de empresa activa, inyectada desde la composición (server.ts) para que auth
 * no dependa de la base de administración.
 */
let companyIsActive: (companyId: string) => boolean = () => true;
export function setCompanyActiveCheck(fn: (companyId: string) => boolean) {
  companyIsActive = fn;
}

function envPass(key: string, fallback: string) {
  return process.env[key] || fallback;
}

function demoUsers(): AuthUser[] {
  const pass = envPass('OPTICLEAN_DEMO_PASSWORD', 'OptiClean2026!');
  const truckPlate = process.env.OPTICLEAN_DRIVER_TRUCK || 'GBA-2041';
  const companyId = process.env.OPTICLEAN_DEFAULT_COMPANY || 'co-innovamf';
  return [
    {
      id: 'U-ADMIN',
      email: (process.env.OPTICLEAN_ADMIN_EMAIL || 'admin@innovamf.com').toLowerCase(),
      name: 'Administración',
      role: 'admin',
      companyId,
      passwordHash: hashPassword(envPass('OPTICLEAN_ADMIN_PASSWORD', pass)),
    },
    {
      id: 'U-BODEGA',
      email: (process.env.OPTICLEAN_BODEGA_EMAIL || 'bodega@innovamf.com').toLowerCase(),
      name: 'Bodega piso',
      role: 'ops',
      companyId,
      passwordHash: hashPassword(envPass('OPTICLEAN_BODEGA_PASSWORD', pass)),
    },
    {
      id: 'U-OPS',
      email: (process.env.OPTICLEAN_OPS_EMAIL || 'ops@innovamf.com').toLowerCase(),
      name: 'Bodega (alias)',
      role: 'ops',
      companyId,
      passwordHash: hashPassword(envPass('OPTICLEAN_OPS_PASSWORD', pass)),
    },
    {
      id: 'U-DESPACHO',
      email: (process.env.OPTICLEAN_DISPATCH_EMAIL || 'despacho@innovamf.com').toLowerCase(),
      name: 'Despacho logística',
      role: 'dispatch',
      companyId,
      passwordHash: hashPassword(envPass('OPTICLEAN_DISPATCH_PASSWORD', pass)),
    },
    {
      id: 'U-DRIVER',
      email: (process.env.OPTICLEAN_DRIVER_EMAIL || 'conductor@innovamf.com').toLowerCase(),
      name: 'Carlos Sur',
      role: 'driver',
      companyId,
      truckPlate,
      passwordHash: hashPassword(envPass('OPTICLEAN_DRIVER_PASSWORD', pass)),
    },
    {
      id: 'U-DEMO-CO',
      email: (process.env.OPTICLEAN_DEMO_CO_EMAIL || 'demo@cliente.com').toLowerCase(),
      name: 'Operador Demo',
      role: 'ops',
      companyId: 'co-demo',
      passwordHash: hashPassword(envPass('OPTICLEAN_DEMO_CO_PASSWORD', pass)),
    },
  ];
}

let usersCache: UsersFile | null = null;

/** Upsert usuarios demo por id (actualiza email/rol/placa/password demo). */
function ensureUsers(): UsersFile {
  if (usersCache) return usersCache;
  mkdirSync(DATA_DIR, { recursive: true });
  const desired = demoUsers();
  let raw: UsersFile = { version: 1, users: [] };
  if (existsSync(USERS_PATH)) {
    try {
      raw = JSON.parse(readFileSync(USERS_PATH, 'utf8')) as UsersFile;
      if (!Array.isArray(raw.users)) raw = { version: 1, users: [] };
    } catch {
      raw = { version: 1, users: [] };
    }
  }

  const byId = new Map(raw.users.map((u) => [u.id, u]));
  if (isProd()) {
    // Producción: sin tenant demo; sí mantiene cuentas operativas definidas por env
    // (bodega / despacho / conductor) para ops.innovamf.com.
    byId.delete('U-DEMO-CO');

    const email = process.env.OPTICLEAN_ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.OPTICLEAN_ADMIN_PASSWORD ?? '';
    const prevAdmin = byId.get('U-ADMIN');
    // El admin demo con la clave conocida no sirve en producción: se reemplaza o se desactiva.
    if (prevAdmin && verifyPassword('OptiClean2026!', prevAdmin.passwordHash)) {
      if (email && password.length >= 12) {
        byId.set('U-ADMIN', { ...prevAdmin, email, passwordHash: hashPassword(password), active: true });
      } else {
        byId.delete('U-ADMIN');
      }
    }
    if (!byId.has('U-ADMIN') && ![...byId.values()].some((u) => u.role === 'admin' && u.active !== false)) {
      if (!email || password.length < 12) {
        throw new Error(
          '[auth] Producción sin administrador: define OPTICLEAN_ADMIN_EMAIL y OPTICLEAN_ADMIN_PASSWORD (12+ caracteres).',
        );
      }
      byId.set('U-ADMIN', {
        id: 'U-ADMIN',
        email,
        name: process.env.OPTICLEAN_ADMIN_NAME?.trim() || 'Administración',
        role: 'admin',
        companyId: process.env.OPTICLEAN_DEFAULT_COMPANY || 'co-innovamf',
        passwordHash: hashPassword(password),
        active: true,
      });
    }

    // Upsert roles de piso desde variables de entorno (no pisa usuarios desactivados a mano).
    for (const u of desired) {
      if (u.id === 'U-ADMIN' || u.id === 'U-DEMO-CO') continue;
      const prev = byId.get(u.id);
      if (prev?.active === false) continue;
      byId.set(u.id, {
        ...u,
        active: true,
        // Conserva placa/nombre si ya los editó un admin.
        name: prev?.name || u.name,
        truckPlate: prev?.truckPlate || u.truckPlate,
      });
    }

    const next: UsersFile = { version: 1, users: [...byId.values()] };
    writeFileSync(USERS_PATH, JSON.stringify(next, null, 2));
    usersCache = next;
    return next;
  }
  for (const u of desired) {
    const prev = byId.get(u.id);
    // Demo: sincroniza credenciales/rol; conserva active si ya existía
    byId.set(u.id, {
      ...u,
      active: prev?.active === false ? false : true,
    });
  }
  const next: UsersFile = { version: 1, users: [...byId.values()] };
  writeFileSync(USERS_PATH, JSON.stringify(next, null, 2));
  usersCache = next;
  return next;
}

function persistUsers(users: AuthUser[]) {
  const next: UsersFile = { version: 1, users };
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(USERS_PATH, JSON.stringify(next, null, 2));
  usersCache = next;
  return next;
}

function toManaged(u: AuthUser): ManagedUser {
  return {
    ...toPublic(u),
    active: u.active !== false,
    isDemo: DEMO_USER_IDS.has(u.id),
  };
}

function normalizeRole(role: string): AuthRole {
  if (!ROLES.includes(role as AuthRole)) {
    throw new Error('Rol no válido. Usa admin, ops, dispatch o driver.');
  }
  return role as AuthRole;
}

export function listUsers(opts?: {
  role?: AuthRole;
  companyId?: string;
  activeOnly?: boolean;
}): ManagedUser[] {
  let users = ensureUsers().users;
  if (opts?.companyId) {
    users = users.filter((u) => (u.companyId || 'co-innovamf') === opts.companyId);
  }
  if (opts?.role) {
    users = users.filter((u) => u.role === opts.role);
  }
  if (opts?.activeOnly) {
    users = users.filter((u) => u.active !== false);
  }
  return users
    .map(toManaged)
    .sort((a, b) => a.name.localeCompare(b.name, 'es') || a.email.localeCompare(b.email));
}

export function getUserById(id: string): ManagedUser | null {
  const u = ensureUsers().users.find((x) => x.id === id);
  return u ? toManaged(u) : null;
}

export function createUser(input: {
  email: string;
  name: string;
  password: string;
  role: string;
  companyId: string;
  truckPlate?: string;
}): ManagedUser {
  const email = String(input.email || '')
    .trim()
    .toLowerCase();
  const name = String(input.name || '').trim();
  const password = String(input.password || '');
  const companyId = String(input.companyId || '').trim() || 'co-innovamf';
  const role = normalizeRole(String(input.role || 'ops'));
  if (!email || !email.includes('@')) throw new Error('Correo no válido.');
  if (!name) throw new Error('El nombre es obligatorio.');
  if (password.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
  const file = ensureUsers();
  if (file.users.some((u) => u.email.toLowerCase() === email)) {
    throw new Error('Ya existe un usuario con ese correo.');
  }
  const truckPlate =
    role === 'driver' ? String(input.truckPlate || '').trim().toUpperCase() || undefined : undefined;
  const user: AuthUser = {
    id: `U-${randomBytes(4).toString('hex').toUpperCase()}`,
    email,
    name,
    role,
    companyId,
    truckPlate,
    passwordHash: hashPassword(password),
    active: true,
  };
  persistUsers([...file.users, user]);
  return toManaged(user);
}

export function updateUser(
  id: string,
  input: {
    email?: string;
    name?: string;
    password?: string;
    role?: string;
    companyId?: string;
    truckPlate?: string | null;
    active?: boolean;
  },
): ManagedUser {
  const file = ensureUsers();
  const idx = file.users.findIndex((u) => u.id === id);
  if (idx < 0) throw new Error('Usuario no encontrado.');
  const current = file.users[idx];
  const next: AuthUser = { ...current };
  if (input.email !== undefined) {
    const email = String(input.email).trim().toLowerCase();
    if (!email.includes('@')) throw new Error('Correo no válido.');
    if (file.users.some((u) => u.id !== id && u.email.toLowerCase() === email)) {
      throw new Error('Ya existe un usuario con ese correo.');
    }
    next.email = email;
  }
  if (input.name !== undefined) {
    const name = String(input.name).trim();
    if (!name) throw new Error('El nombre es obligatorio.');
    next.name = name;
  }
  if (input.role !== undefined) next.role = normalizeRole(String(input.role));
  if (input.companyId !== undefined) {
    next.companyId = String(input.companyId).trim() || next.companyId;
  }
  if (input.password !== undefined && String(input.password).length > 0) {
    if (String(input.password).length < 8) {
      throw new Error('La contraseña debe tener al menos 8 caracteres.');
    }
    next.passwordHash = hashPassword(String(input.password));
  }
  if (input.active !== undefined) next.active = Boolean(input.active);
  if (input.truckPlate !== undefined) {
    next.truckPlate =
      next.role === 'driver'
        ? String(input.truckPlate || '')
            .trim()
            .toUpperCase() || undefined
        : undefined;
  } else if (next.role !== 'driver') {
    next.truckPlate = undefined;
  }
  const users = [...file.users];
  users[idx] = next;
  persistUsers(users);
  return toManaged(next);
}

/** Baja lógica. Los demo no se borran del archivo. */
export function deactivateUser(id: string): ManagedUser {
  return updateUser(id, { active: false });
}

export function login(email: string, password: string) {
  const users = ensureUsers().users;
  const user = users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
  if (!user || user.active === false || !verifyPassword(password, user.passwordHash)) {
    throw new Error('Correo o contraseña incorrectos');
  }
  if (!isPlatformAdmin(user) && !companyIsActive(user.companyId || 'co-innovamf')) {
    throw new Error('Tu empresa está desactivada. Contacta a soporte.');
  }
  const publicUser = toPublic(user);
  return { token: signToken(publicUser), user: publicUser };
}

/** Cambia la contraseña del usuario autenticado (flujo local / fallback). */
export function changePassword(userId: string, currentPassword: string, newPassword: string) {
  const file = ensureUsers();
  const user = file.users.find((u) => u.id === userId);
  if (!user || user.active === false) throw new Error('Usuario no encontrado.');
  if (!verifyPassword(currentPassword, user.passwordHash)) {
    throw new Error('La contraseña actual no es correcta.');
  }
  if (String(newPassword || '').length < 8) {
    throw new Error('La nueva contraseña debe tener al menos 8 caracteres.');
  }
  updateUser(userId, { password: newPassword });
  return { ok: true as const, message: 'Contraseña actualizada.' };
}

type LocalReset = { token: string; userId: string; email: string; expiresAt: number };
const localResets = new Map<string, LocalReset>();

export function requestPasswordReset(email: string) {
  const user = ensureUsers().users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
  const generic = {
    ok: true as const,
    message: 'Si el correo existe, enviaremos instrucciones para restablecer la contraseña.',
  };
  if (!user || user.active === false) return generic;
  const token = randomBytes(32).toString('hex');
  localResets.set(token, {
    token,
    userId: user.id,
    email: user.email,
    expiresAt: Date.now() + 30 * 60_000,
  });
  const base = process.env.AUTH_RESET_BASE_URL || 'https://opti.innovamf.com/restablecer';
  const resetUrl = `${base}?app=opticlean&token=${encodeURIComponent(token)}`;
  if (process.env.AUTH_EXPOSE_RESET_LINK !== '0') {
    return { ...generic, resetUrl, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() };
  }
  return generic;
}

export function resetPasswordWithToken(token: string, newPassword: string) {
  const row = localResets.get(String(token || ''));
  if (!row || row.expiresAt < Date.now()) {
    throw new Error('El enlace no es válido o expiró.');
  }
  if (String(newPassword || '').length < 8) {
    throw new Error('La nueva contraseña debe tener al menos 8 caracteres.');
  }
  updateUser(row.userId, { password: newPassword });
  localResets.delete(token);
  return { ok: true as const, message: 'Contraseña restablecida. Ya puedes iniciar sesión.' };
}

export function authRequired(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    res.status(401).json({ error: 'Debes iniciar sesión' });
    return;
  }
  const user = verifyToken(token);
  if (!user) {
    res.status(401).json({ error: 'Sesión expirada o inválida' });
    return;
  }
  if (!user.platformAdmin && !companyIsActive(user.companyId)) {
    res.status(403).json({ error: 'Tu empresa está desactivada. Contacta a soporte.' });
    return;
  }
  req.user = user;
  next();
}

export function adminRequired(req: Request, res: Response, next: NextFunction) {
  authRequired(req, res, () => {
    if (req.user?.role !== 'admin') {
      res.status(403).json({ error: 'Solo administración' });
      return;
    }
    next();
  });
}

/** Solo administradores de la plataforma: gestión de empresas, módulos y menú global. */
export function platformAdminRequired(req: Request, res: Response, next: NextFunction) {
  authRequired(req, res, () => {
    if (req.user?.role !== 'admin' || !req.user.platformAdmin) {
      res.status(403).json({ error: 'Solo administración de la plataforma' });
      return;
    }
    next();
  });
}

/** Correo libre para registrar (sin crear nada). Lanza si no es válido o ya existe. */
export function assertEmailAvailable(rawEmail: string) {
  const email = String(rawEmail || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Correo no válido.');
  if (ensureUsers().users.some((u) => u.email.toLowerCase() === email)) {
    throw new Error('Ya existe un usuario con ese correo.');
  }
  return email;
}

export function publicUserFromRequest(req: Request) {
  return req.user ?? null;
}

/** admin siempre pasa; el resto solo si su rol está en la lista. */
export function requireRole(...roles: AuthRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = req.user?.role;
    if (role && (role === 'admin' || roles.includes(role))) return next();
    res.status(403).json({ error: 'Tu rol no tiene permiso para esta acción.' });
  };
}

/** Valida la configuración de seguridad al arrancar (falla rápido en producción). */
export function prepareAuth() {
  jwtSecret();
  ensureUsers();
}

export function warnInsecureSecret() {
  if (!process.env.OPTICLEAN_JWT_SECRET?.trim() || process.env.OPTICLEAN_JWT_SECRET === 'cambia-este-secreto') {
    console.warn('[auth] OPTICLEAN_JWT_SECRET no está configurado: los tokens usan un secreto inseguro.');
  }
}
