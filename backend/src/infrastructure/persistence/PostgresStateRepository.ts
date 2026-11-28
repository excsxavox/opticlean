import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { StateRepository } from '../../application/ports/StateRepository.js';
import { migrateState } from '../../domain/state-migrate.js';
import { currentCompanyId } from '../../domain/request-context.js';
import type { AppState } from '../../domain/types.js';
import { initialStateFor } from './initial-state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIR = path.resolve(__dirname, '../../../data');
const backupDaysKept = () => Math.max(1, Number(process.env.OPTICLEAN_BACKUPS_KEPT ?? 14) || 14);

const SCHEMA = `
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
`;

/**
 * Estado por empresa en PostgreSQL (una fila JSONB por empresa).
 *
 * Cada escritura corre en una transacción con la fila bloqueada (`SELECT … FOR UPDATE`),
 * así dos usuarios —o dos procesos del API— que guardan a la vez no se pisan. Antes de la
 * primera escritura de cada día se guarda una copia en `app_state_backup` y se conservan
 * los últimos `OPTICLEAN_BACKUPS_KEPT` días.
 */
export class PostgresStateRepository implements StateRepository {
  private readonly pool: pg.Pool;
  private ready: Promise<void> | null = null;
  private readonly backedUp = new Set<string>();

  constructor(connection: string | pg.Pool = process.env.DATABASE_URL ?? '') {
    if (typeof connection === 'string') {
      if (!connection.trim()) throw new Error('Falta DATABASE_URL para usar PostgreSQL.');
      this.pool = new pg.Pool({
        connectionString: connection,
        max: Number(process.env.OPTICLEAN_PG_POOL ?? 10) || 10,
        ssl: process.env.OPTICLEAN_PG_SSL === '1' ? { rejectUnauthorized: false } : undefined,
      });
    } else {
      this.pool = connection;
    }
  }

  /** Carpeta de los respaldos de archivos que no viven en la base (usuarios, empresas). */
  get backupsDir() {
    return path.join(process.env.OPTICLEAN_DATA_DIR?.trim() || DEFAULT_DATA_DIR, 'backups');
  }

  /** Crea las tablas la primera vez. */
  private init() {
    this.ready ??= this.pool.query(SCHEMA).then(() => undefined);
    return this.ready;
  }

  async close() {
    await this.pool.end();
  }

  async load(): Promise<AppState> {
    await this.init();
    const companyId = currentCompanyId();
    const found = await this.pool.query<{ state: AppState }>('SELECT state FROM app_state WHERE company_id = $1', [companyId]);
    if (found.rows[0]) return migrateState(found.rows[0].state);
    // Primera lectura de la empresa: se crea su estado inicial (sin pisar a otro proceso que lo cree a la vez).
    const initial = migrateState(initialStateFor(companyId));
    await this.pool.query('INSERT INTO app_state (company_id, state) VALUES ($1, $2) ON CONFLICT (company_id) DO NOTHING', [
      companyId,
      JSON.stringify(initial),
    ]);
    const again = await this.pool.query<{ state: AppState }>('SELECT state FROM app_state WHERE company_id = $1', [companyId]);
    return migrateState(again.rows[0].state);
  }

  async save(state: AppState): Promise<void> {
    await this.init();
    await this.upsert(this.pool, currentCompanyId(), state);
  }

  async transaction<T>(fn: (state: AppState) => T | Promise<T>): Promise<{ state: AppState; result: T }> {
    await this.init();
    const companyId = currentCompanyId();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO app_state (company_id, state) VALUES ($1, $2) ON CONFLICT (company_id) DO NOTHING', [
        companyId,
        JSON.stringify(migrateState(initialStateFor(companyId))),
      ]);
      const locked = await client.query<{ state: AppState }>(
        'SELECT state FROM app_state WHERE company_id = $1 FOR UPDATE',
        [companyId],
      );
      const state = migrateState(locked.rows[0].state);
      const result = await fn(state);
      await this.dailyBackup(client, companyId, locked.rows[0].state);
      await this.upsert(client, companyId, state);
      await client.query('COMMIT');
      return { state, result };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  async reset(): Promise<AppState> {
    const { state } = await this.transaction(async (current) => {
      const fresh = migrateState(initialStateFor(currentCompanyId()));
      for (const key of Object.keys(current) as Array<keyof AppState>) delete current[key];
      Object.assign(current, fresh);
    });
    return state;
  }

  private async upsert(db: pg.Pool | pg.PoolClient, companyId: string, state: AppState) {
    await db.query(
      `INSERT INTO app_state (company_id, state, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (company_id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
      [companyId, JSON.stringify(state)],
    );
  }

  /** Copia del estado anterior a la primera escritura del día. */
  private async dailyBackup(client: pg.PoolClient, companyId: string, before: AppState) {
    const day = new Date().toISOString().slice(0, 10);
    const key = `${companyId}:${day}`;
    if (this.backedUp.has(key)) return;
    await client.query(
      'INSERT INTO app_state_backup (company_id, day, state) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [companyId, day, JSON.stringify(before)],
    );
    await client.query(
      `DELETE FROM app_state_backup
       WHERE company_id = $1 AND day NOT IN (
         SELECT day FROM app_state_backup WHERE company_id = $1 ORDER BY day DESC LIMIT $2
       )`,
      [companyId, backupDaysKept()],
    );
    this.backedUp.add(key);
  }
}
