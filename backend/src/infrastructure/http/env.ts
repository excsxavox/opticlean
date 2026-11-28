import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Se evalúan al usarse porque `.env` se carga más abajo.
export const isProd = () => process.env.NODE_ENV === 'production';
/** El reinicio a datos demo solo existe fuera de producción (o con permiso explícito). */
export const resetAllowed = () => !isProd() || process.env.OPTICLEAN_ALLOW_RESET === '1';
/** Registro público de empresas: activo en desarrollo; en producción solo con OPTICLEAN_SIGNUP_ENABLED=1. */
export const signupEnabled = () =>
  process.env.OPTICLEAN_SIGNUP_ENABLED === '1' || (!isProd() && process.env.OPTICLEAN_SIGNUP_ENABLED !== '0');

/** Carga backend/.env sin dependencia extra (no pisa vars ya definidas, p.ej. systemd). */
export function loadEnvFile() {
  const path = resolve(process.cwd(), '.env');
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i <= 0) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
