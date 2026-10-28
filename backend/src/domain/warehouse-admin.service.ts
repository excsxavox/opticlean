import type { AppState, WarehouseSite } from './types.js';
import { uid } from './inventory.service.js';
import { normalizeLayout, validateLayoutForWarehouse } from './warehouse-layout.js';

export const DEFAULT_WAREHOUSE_ID = 'WH-QT-01';

export function activeWarehouseId(s: AppState): string {
  return s.settings.activeWarehouseId ?? s.warehouses[0]?.id ?? DEFAULT_WAREHOUSE_ID;
}

export function activeWarehouse(s: AppState): WarehouseSite | undefined {
  return s.warehouses.find((w) => w.id === activeWarehouseId(s));
}

export function lotsForActiveWarehouse(s: AppState) {
  const wid = activeWarehouseId(s);
  return s.lots.filter((l) => (l.warehouseId ?? DEFAULT_WAREHOUSE_ID) === wid);
}

export function syncSettingsWarehouseLabel(s: AppState) {
  const w = activeWarehouse(s);
  if (w) s.settings.warehouse = `${w.name} · ${w.city}`;
}

export function upsertWarehouse(s: AppState, data: WarehouseSite) {
  if (!data.code?.trim() || !data.name?.trim()) {
    throw new Error('Código y nombre de bodega son obligatorios.');
  }
  const layout = normalizeLayout(data.layout ?? { racks: data.racks });
  data.layout = layout;
  data.racks = layout.rackCount;
  validateLayoutForWarehouse(s, data.id, layout);
  const existing = s.warehouses.find((w) => w.id === data.id);
  if (existing) Object.assign(existing, data);
  else {
    if (s.warehouses.some((w) => w.code.toUpperCase() === data.code.toUpperCase())) {
      throw new Error('Ya existe una bodega con este código.');
    }
    s.warehouses.push(data);
  }
  syncSettingsWarehouseLabel(s);
}

export function createWarehouse(
  s: AppState,
  body: Omit<WarehouseSite, 'id'> & { id?: string },
) {
  const id = body.id ?? uid('WH');
  upsertWarehouse(s, {
    id,
    code: body.code.trim().toUpperCase(),
    name: body.name.trim(),
    city: body.city.trim(),
    address: body.address.trim(),
    status: body.status,
    racks: normalizeLayout(body.layout ?? { racks: body.racks }).rackCount,
    layout: normalizeLayout(body.layout ?? { racks: body.racks }),
    notes: body.notes?.trim(),
  });
  return id;
}

export function deleteWarehouse(s: AppState, id: string) {
  if (id === activeWarehouseId(s)) {
    throw new Error('No puedes eliminar la bodega activa. Activa otra primero.');
  }
  const hasStock = s.lots.some((l) => (l.warehouseId ?? DEFAULT_WAREHOUSE_ID) === id);
  if (hasStock) throw new Error('La bodega tiene existencias. Traslada o ajusta el stock antes.');
  s.warehouses = s.warehouses.filter((w) => w.id !== id);
}

export function activateWarehouse(s: AppState, id: string) {
  const w = s.warehouses.find((x) => x.id === id);
  if (!w) throw new Error('Bodega no encontrada.');
  if (w.status === 'Inactiva') {
    throw new Error('Activa la bodega en el catálogo antes de usarla en operación.');
  }
  s.settings.activeWarehouseId = id;
  syncSettingsWarehouseLabel(s);
}
