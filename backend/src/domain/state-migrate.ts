import { seed } from './seed.js';
import type { AppState } from './types.js';
import { DEFAULT_WAREHOUSE_ID, syncSettingsWarehouseLabel } from './warehouse-admin.service.js';
import { DEFAULT_LAYOUT, normalizeLayout } from './warehouse-layout.js';

export function migrateState(raw: AppState): AppState {
  const base = raw;
  if (!base.warehouses?.length) {
    base.warehouses = seed().warehouses;
  }
  if (!base.settings.activeWarehouseId) {
    base.settings.activeWarehouseId = DEFAULT_WAREHOUSE_ID;
  }
  for (const lot of base.lots) {
    if (!lot.warehouseId) lot.warehouseId = DEFAULT_WAREHOUSE_ID;
  }
  for (const w of base.warehouses) {
    if (!w.layout) {
      w.layout = normalizeLayout({ racks: w.racks ?? DEFAULT_LAYOUT.rackCount, ...DEFAULT_LAYOUT });
      w.racks = w.layout.rackCount;
    }
  }
  syncSettingsWarehouseLabel(base);
  return base;
}
