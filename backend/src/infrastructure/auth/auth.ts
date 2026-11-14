import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextFunction, Request, Response } from 'express';

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'ops';
  passwordHash: string;
};

export type PublicUser = {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'ops';
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
      role: 'admin' | 'ops';
      exp: number;
    };
    if (!body.exp || body.exp * 1000 < Date.now()) return null;
    return { id: body.sub, email: body.email, name: body.name, role: body.role };
  } catch {
    return null;
  }
}

function toPublic(u: AuthUser): PublicUser {
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}

function defaultUsers(): AuthUser[] {
  const adminEmail = (process.env.OPTICLEAN_ADMIN_EMAIL || 'admin@innovamf.com').toLowerCase();
  const adminPass = process.env.OPTICLEAN_ADMIN_PASSWORD || 'OptiClean2026!';
  const opsEmail = (process.env.OPTICLEAN_OPS_EMAIL || 'ops@innovamf.com').toLowerCase();
  const opsPass = process.env.OPTICLEAN_OPS_PASSWORD || 'OptiClean2026!';
  return [
    {
      id: 'U-ADMIN',
      email: adminEmail,
      name: 'Administración',
      role: 'admin',
      passwordHash: hashPassword(adminPass),
    },
    {
      id: 'U-OPS',
      email: opsEmail,
      name: 'Operaciones piso',
      role: 'ops',
      passwordHash: hashPassword(opsPass),
    },
  ];
}

function ensureUsers(): UsersFile {
  mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(USERS_PATH)) {
    const seed: UsersFile = { version: 1, users: defaultUsers() };
    writeFileSync(USERS_PATH, JSON.stringify(seed, null, 2));
    return seed;
  }
  try {
    const raw = JSON.parse(readFileSync(USERS_PATH, 'utf8')) as UsersFile;
    if (!raw?.users?.length) throw new Error('empty');
    return raw;
  } catch {
    const seed: UsersFile = { version: 1, users: defaultUsers() };
    writeFileSync(USERS_PATH, JSON.stringify(seed, null, 2));
    return seed;
  }
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
