import type { AppState } from '../../domain/types.js';

export interface StateRepository {
  load(): Promise<AppState>;
  save(state: AppState): Promise<void>;
  reset(): Promise<AppState>;
}
