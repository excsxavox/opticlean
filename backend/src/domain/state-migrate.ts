import { seed } from './seed.js';
import type { AppState } from './types.js';
import { DEFAULT_WAREHOUSE_ID, syncSettingsWarehouseLabel } from './warehouse-admin.service.js';
import {
  DEFAULT_LAYOUT,
  isSingleFaceLocId,
  normalizeLayout,
  toDelanteraLocId,
} from './warehouse-layout.js';

function remapWarehouseLocationRefs(base: AppState, warehouseId: string) {
  const touch = (loc: string | undefined) => {
    if (!loc || !isSingleFaceLocId(loc)) return loc;
    return toDelanteraLocId(loc);
  };

  for (const lot of base.lots) {
    if ((lot.warehouseId ?? DEFAULT_WAREHOUSE_ID) === warehouseId) {
      lot.loc = touch(lot.loc) ?? lot.loc;
    }
  }
  for (const ev of base.events) {
    ev.from = touch(ev.from) ?? ev.from;
    ev.to = touch(ev.to) ?? ev.to;
  }
  for (const o of base.orders) {
    for (const p of o.picks ?? []) {
      if (p.loc) p.loc = touch(p.loc) ?? p.loc;
    }
  }
  for (const r of base.receipts ?? []) {
    r.loc = touch(r.loc) ?? r.loc;
  }
}

function applyQuitoDualDepth(base: AppState) {
  const qt = base.warehouses.find((w) => w.id === DEFAULT_WAREHOUSE_ID);
  if (!qt) return;
  qt.layout = normalizeLayout({ ...qt.layout, ...DEFAULT_LAYOUT, depthFaces: 2 });
  qt.racks = qt.layout.rackCount;
  qt.notes = 'Layout 3D con doble profundidad (144 posiciones).';
  remapWarehouseLocationRefs(base, DEFAULT_WAREHOUSE_ID);
}

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
    w.layout = normalizeLayout({ racks: w.racks ?? DEFAULT_LAYOUT.rackCount, ...w.layout });
    w.racks = w.layout.rackCount;
  }

  if (base.version === 1) {
    applyQuitoDualDepth(base);
    base.version = 2;
  }

  syncSettingsWarehouseLabel(base);
  return base;
}
