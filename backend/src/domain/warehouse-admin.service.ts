import type { AppState, WarehouseSite } from './types.js';
import { uid } from './inventory.service.js';
import { normalizeLayout, validateLayoutForWarehouse } from './warehouse-layout.js';
import { validateRackPositions } from './rack-positioning.js';

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
  const code = typeof data.code === 'string' ? data.code.trim().toUpperCase() : '';
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  if (!code || !name) {
    throw new Error('Código y nombre de bodega son obligatorios.');
  }
  if (s.warehouses.some((w) => w.id !== data.id && w.code.trim().toUpperCase() === code)) {
    throw new Error('Ya existe una bodega con este código.');
  }
  if (data.status !== 'Operativa' && data.status !== 'Inactiva') {
    throw new Error('Selecciona un estado válido: Operativa o Inactiva.');
  }
  if (data.id === activeWarehouseId(s) && data.status === 'Inactiva') {
    throw new Error('No puedes desactivar la bodega en uso. Selecciona otra para operar primero.');
  }
  const layout = normalizeLayout(data.layout ?? { racks: data.racks });
  validateRackPositions(layout.rackCount, data.layout?.rackPositions);
  validateLayoutForWarehouse(s, data.id, layout);
  const quantities = new Map<string, number>();
  for (const lot of s.lots) {
    if ((lot.warehouseId ?? DEFAULT_WAREHOUSE_ID) === data.id) {
      quantities.set(lot.loc, (quantities.get(lot.loc) ?? 0) + lot.qty);
    }
  }
  for (const [location, qty] of quantities) {
    if (qty > layout.capacityPerCell) {
      throw new Error(
        `La ubicación ${location} tiene ${qty} u. y supera la capacidad de ${layout.capacityPerCell} u. Aumenta la capacidad por casilla o traslada el excedente.`,
      );
    }
  }
  const warehouse: WarehouseSite = {
    ...data,
    code,
    name,
    city: typeof data.city === 'string' ? data.city.trim() : '',
    address: typeof data.address === 'string' ? data.address.trim() : '',
    notes: typeof data.notes === 'string' ? data.notes.trim() : undefined,
    layout,
    racks: layout.rackCount,
  };
  const existing = s.warehouses.find((w) => w.id === data.id);
  if (existing) Object.assign(existing, warehouse);
  else s.warehouses.push(warehouse);
  syncSettingsWarehouseLabel(s);
}

export function createWarehouse(
  s: AppState,
  body: Omit<WarehouseSite, 'id'> & { id?: string },
) {
  const id = body.id ?? uid('WH');
  upsertWarehouse(s, { ...body, id });
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
