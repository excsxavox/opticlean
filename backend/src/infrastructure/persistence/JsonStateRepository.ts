import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StateRepository } from '../../application/ports/StateRepository.js';
import { seed } from '../../domain/seed.js';
import { migrateState } from '../../domain/state-migrate.js';
import type { AppState } from '../../domain/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../../data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

export class JsonStateRepository implements StateRepository {
  private async ensureDir() {
    await mkdir(DATA_DIR, { recursive: true });
  }

  async load(): Promise<AppState> {
    await this.ensureDir();
    try {
      const raw = await readFile(STATE_FILE, 'utf8');
      const parsed = JSON.parse(raw) as AppState;
      if (parsed?.version === 1) {
        const migrated = migrateState(parsed);
        await this.save(migrated);
        return migrated;
      }
    } catch {
      /* seed on first run */
    }
    const initial = seed();
    await this.save(initial);
    return initial;
  }

  async save(state: AppState): Promise<void> {
    await this.ensureDir();
    await writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  }

  async reset(): Promise<AppState> {
    const initial = seed();
    await this.save(initial);
    return initial;
  }
}
