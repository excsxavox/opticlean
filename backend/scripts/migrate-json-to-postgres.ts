/**
 * Copia el estado de cada empresa de los archivos JSON a PostgreSQL.
 *
 *   DATABASE_URL=postgres://… npm run migrate:pg            # solo empresas que aún no existen
 *   DATABASE_URL=postgres://… npm run migrate:pg -- --force  # sobrescribe las existentes
 *   … npm run migrate:pg -- --dry-run                        # solo muestra qué haría
 *
 * Lee OPTICLEAN_DATA_DIR (o backend/data): `state.json` es la empresa por defecto y
 * `state-<empresa>.json` las demás. Los archivos no se tocan.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { DEFAULT_COMPANY_ID } from '../src/domain/request-context.js';
import { migrateState } from '../src/domain/state-migrate.js';
import type { AppState } from '../src/domain/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.OPTICLEAN_DATA_DIR?.trim() || path.resolve(here, '../data');
const url = process.env.DATABASE_URL?.trim();
const force = process.argv.includes('--force');
const dryRun = process.argv.includes('--dry-run');

if (!url) {
  console.error('Falta DATABASE_URL.');
  process.exit(1);
}

const files = (await readdir(dataDir)).filter((name) => /^state(-[A-Za-z0-9_-]+)?\.json$/.test(name)).sort();
if (!files.length) {
  console.log(`No hay archivos de estado en ${dataDir}.`);
  process.exit(0);
}

const pool = new pg.Pool({
  connectionString: url,
  ssl: process.env.OPTICLEAN_PG_SSL === '1' ? { rejectUnauthorized: false } : undefined,
});
await pool.query(`
  CREATE TABLE IF NOT EXISTS app_state (
    company_id text PRIMARY KEY,
    state      jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS app_state_backup (
    company_id text NOT NULL,
    day        date NOT NULL,
    state      jsonb NOT NULL,
    PRIMARY KEY (company_id, day)
  );
`);

let copied = 0;
let skipped = 0;
for (const name of files) {
  const companyId = name === 'state.json' ? DEFAULT_COMPANY_ID : name.slice('state-'.length, -'.json'.length);
  const raw = await readFile(path.join(dataDir, name), 'utf8');
  const state = migrateState(JSON.parse(raw) as AppState);
  const exists = (await pool.query('SELECT 1 FROM app_state WHERE company_id = $1', [companyId])).rowCount! > 0;
  if (exists && !force) {
    console.log(`= ${companyId}: ya existe en PostgreSQL (usa --force para sobrescribir).`);
    skipped++;
    continue;
  }
  console.log(
    `${dryRun ? '? ' : '+ '}${companyId}: ${state.products.length} productos, ${state.clients.length} clientes, ${state.orders.length} pedidos`,
  );
  if (!dryRun) {
    await pool.query(
      `INSERT INTO app_state (company_id, state, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (company_id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
      [companyId, JSON.stringify(state)],
    );
  }
  copied++;
}
await pool.end();
console.log(`${dryRun ? 'Simulación: ' : ''}${copied} empresa(s) migradas, ${skipped} omitidas.`);
