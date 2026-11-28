import { copyFile, readdir, readFile, rename, writeFile, mkdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StateRepository } from '../../application/ports/StateRepository.js';
import { migrateState } from '../../domain/state-migrate.js';
import { initialStateFor } from './initial-state.js';
import { currentCompanyId, DEFAULT_COMPANY_ID } from '../../domain/request-context.js';
import type { AppState } from '../../domain/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIR = path.resolve(__dirname, '../../../data');
const backupsKept = () => Math.max(1, Number(process.env.OPTICLEAN_BACKUPS_KEPT ?? 14) || 14);

const safeId = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, '_');

/**
 * Un archivo de estado por empresa. La empresa por defecto conserva `state.json`
 * (datos existentes); las demás empiezan vacías, sin datos de demostración.
 *
 * Las escrituras de una misma empresa pasan en fila (`transaction`), así dos usuarios
 * que guardan a la vez no se pisan. Antes de la primera escritura de cada día se copia
 * el archivo a `backups/` y se conservan los últimos `OPTICLEAN_BACKUPS_KEPT` días.
 */
export class JsonStateRepository implements StateRepository {
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly backedUp = new Set<string>();

  constructor(private readonly dataDir = process.env.OPTICLEAN_DATA_DIR?.trim() || DEFAULT_DATA_DIR) {}

  /** Carpeta de respaldos diarios. */
  get backupsDir() {
    return path.join(this.dataDir, 'backups');
  }

  private fileFor(companyId: string) {
    return companyId === DEFAULT_COMPANY_ID
      ? path.join(this.dataDir, 'state.json')
      : path.join(this.dataDir, `state-${safeId(companyId)}.json`);
  }

  private initialFor(companyId: string): AppState {
    return initialStateFor(companyId);
  }

  async load(): Promise<AppState> {
    return this.loadFor(currentCompanyId());
  }

  private async loadFor(companyId: string): Promise<AppState> {
    await mkdir(this.dataDir, { recursive: true });
    const file = this.fileFor(companyId);
    try {
      const raw = await readFile(file, 'utf8');
      const parsed = JSON.parse(raw) as AppState;
      if (parsed?.version === 1 || parsed?.version === 2) {
        const migrated = migrateState(parsed);
        if (migrated.version !== parsed.version || JSON.stringify(migrated, null, 2) !== raw) {
          await this.write(companyId, migrated);
        }
        return migrated;
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        const backup = `${file}.corrupt-${Date.now()}`;
        await rename(file, backup).catch(() => undefined);
        console.error(`[state] ${path.basename(file)} ilegible; respaldo en ${backup}`, err);
      }
    }
    const initial = migrateState(this.initialFor(companyId));
    await this.write(companyId, initial);
    return initial;
  }

  async save(state: AppState): Promise<void> {
    await this.write(currentCompanyId(), state);
  }

  /** Lee, modifica y guarda sin que otra escritura de la misma empresa se intercale. */
  async transaction<T>(fn: (state: AppState) => T | Promise<T>): Promise<{ state: AppState; result: T }> {
    const companyId = currentCompanyId();
    const prev = this.queues.get(companyId) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(async () => {
      const state = await this.loadFor(companyId);
      const result = await fn(state);
      await this.write(companyId, state);
      return { state, result };
    });
    this.queues.set(companyId, run);
    try {
      return await run;
    } finally {
      if (this.queues.get(companyId) === run) this.queues.delete(companyId);
    }
  }

  async reset(): Promise<AppState> {
    const { state } = await this.transaction(async (current) => {
      const fresh = migrateState(this.initialFor(currentCompanyId()));
      for (const key of Object.keys(current) as Array<keyof AppState>) delete current[key];
      Object.assign(current, fresh);
    });
    return state;
  }

  private async write(companyId: string, state: AppState) {
    await mkdir(this.dataDir, { recursive: true });
    const file = this.fileFor(companyId);
    await this.dailyBackup(companyId, file);
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
    await rename(tmp, file);
  }

  private async dailyBackup(companyId: string, file: string) {
    const day = new Date().toISOString().slice(0, 10);
    const key = `${companyId}:${day}`;
    if (this.backedUp.has(key) || !existsSync(file)) return;
    const dir = path.join(this.dataDir, 'backups');
    await mkdir(dir, { recursive: true });
    const base = path.basename(file, '.json');
    const target = path.join(dir, `${base}-${day}.json`);
    if (!existsSync(target)) await copyFile(file, target);
    this.backedUp.add(key);
    const mine = (await readdir(dir))
      .filter((name) => name.startsWith(`${base}-`) && /\d{4}-\d{2}-\d{2}\.json$/.test(name))
      .sort();
    for (const old of mine.slice(0, Math.max(0, mine.length - backupsKept()))) {
      await unlink(path.join(dir, old)).catch(() => undefined);
    }
  }
}
