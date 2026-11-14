import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextFunction, Request, Response } from 'express';

/** admin | ops=bodega | dispatch=despacho | driver=conductor */
export type AuthRole = 'admin' | 'ops' | 'dispatch' | 'driver';

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: AuthRole;
  /** Placa asignada al conductor */
  truckPlate?: string;
  passwordHash: string;
};

export type PublicUser = {
  id: string;
  email: string;
  name: string;
  role: AuthRole;
  truckPlate?: string;
};

type UsersFile = { version: 1; users: AuthUser[] };

declare global {
  namespace Express {
    interface Request {
      user?: PublicUser;
    }
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../../../data');
const USERS_PATH = path.join(DATA_DIR, 'users.json');

const JWT_SECRET =
  process.env.OPTICLEAN_JWT_SECRET?.trim() ||
  'opticlean-dev-secret-change-me-in-production';
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
  const payload = b64url(
    JSON.stringify({
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      truckPlate: user.truckPlate,
      iat: now,
      exp: now + TOKEN_TTL_SEC,
    }),
  );
  const data = `${header}.${payload}`;
  const sig = createHmac('sha256', JWT_SECRET).update(data).digest();
  return `${data}.${b64url(sig)}`;
}

export function verifyToken(token: string): PublicUser | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  const data = `${header}.${payload}`;
  const expected = createHmac('sha256', JWT_SECRET).update(data).digest();
  const got = fromB64url(sig);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  try {
    const body = JSON.parse(fromB64url(payload).toString('utf8')) as {
      sub: string;
      email: string;
      name: string;
      role: AuthRole;
      truckPlate?: string;
      exp: number;
    };
    if (!body.exp || body.exp * 1000 < Date.now()) return null;
    return {
      id: body.sub,
      email: body.email,
      name: body.name,
      role: body.role,
      truckPlate: body.truckPlate,
    };
  } catch {
    return null;
  }
}

function toPublic(u: AuthUser): PublicUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    truckPlate: u.truckPlate,
  };
}

function envPass(key: string, fallback: string) {
  return process.env[key] || fallback;
}

function demoUsers(): AuthUser[] {
  const pass = envPass('OPTICLEAN_DEMO_PASSWORD', 'OptiClean2026!');
  const truckPlate = process.env.OPTICLEAN_DRIVER_TRUCK || 'GBA-2041';
  return [
    {
      id: 'U-ADMIN',
      email: (process.env.OPTICLEAN_ADMIN_EMAIL || 'admin@innovamf.com').toLowerCase(),
      name: 'Administración',
      role: 'admin',
      passwordHash: hashPassword(envPass('OPTICLEAN_ADMIN_PASSWORD', pass)),
    },
    {
      id: 'U-BODEGA',
      email: (process.env.OPTICLEAN_BODEGA_EMAIL || 'bodega@innovamf.com').toLowerCase(),
      name: 'Bodega piso',
      role: 'ops',
      passwordHash: hashPassword(envPass('OPTICLEAN_BODEGA_PASSWORD', pass)),
    },
    {
      id: 'U-OPS',
      email: (process.env.OPTICLEAN_OPS_EMAIL || 'ops@innovamf.com').toLowerCase(),
      name: 'Bodega (alias)',
      role: 'ops',
      passwordHash: hashPassword(envPass('OPTICLEAN_OPS_PASSWORD', pass)),
    },
    {
      id: 'U-DESPACHO',
      email: (process.env.OPTICLEAN_DISPATCH_EMAIL || 'despacho@innovamf.com').toLowerCase(),
      name: 'Despacho logística',
      role: 'dispatch',
      passwordHash: hashPassword(envPass('OPTICLEAN_DISPATCH_PASSWORD', pass)),
    },
    {
      id: 'U-DRIVER',
      email: (process.env.OPTICLEAN_DRIVER_EMAIL || 'conductor@innovamf.com').toLowerCase(),
      name: 'Carlos Sur',
      role: 'driver',
      truckPlate,
      passwordHash: hashPassword(envPass('OPTICLEAN_DRIVER_PASSWORD', pass)),
    },
  ];
}

/** Upsert usuarios demo por id (actualiza email/rol/placa/password demo). */
function ensureUsers(): UsersFile {
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
  for (const u of desired) {
    // Usuarios demo siempre sincronizados desde .env
    byId.set(u.id, u);
  }
  const next: UsersFile = { version: 1, users: [...byId.values()] };
  writeFileSync(USERS_PATH, JSON.stringify(next, null, 2));
  return next;
}

export function login(email: string, password: string) {
  const users = ensureUsers().users;
  const user = users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw new Error('Correo o contraseña incorrectos');
  }
  const publicUser = toPublic(user);
  return { token: signToken(publicUser), user: publicUser };
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
  req.user = user;
  next();
}

export function publicUserFromRequest(req: Request) {
  return req.user ?? null;
}
