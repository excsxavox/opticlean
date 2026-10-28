import type { AppState, Location, Rack, WarehouseLayout } from './types.js';
import { activeWarehouse } from './warehouse-admin.service.js';
import { categories } from './warehouse.js';

export const DEFAULT_LAYOUT: WarehouseLayout = {
  rackCount: 6,
  levels: 3,
  positionsPerLevel: 4,
  capacityPerCell: 60,
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function normalizeLayout(input?: Partial<WarehouseLayout> & { racks?: number }): WarehouseLayout {
  return {
    rackCount: clamp(input?.rackCount ?? input?.racks ?? DEFAULT_LAYOUT.rackCount, 1, 12),
    levels: clamp(input?.levels ?? DEFAULT_LAYOUT.levels, 1, 5),
    positionsPerLevel: clamp(input?.positionsPerLevel ?? DEFAULT_LAYOUT.positionsPerLevel, 1, 8),
    capacityPerCell: clamp(input?.capacityPerCell ?? DEFAULT_LAYOUT.capacityPerCell, 10, 200),
  };
}

function rackLetter(index: number) {
  return String.fromCharCode(65 + index);
}

export function buildWarehouseGeometry(layout: WarehouseLayout) {
  const cols = 2;
  const categoryCycle = [...categories];
  const racks: Rack[] = [];
  for (let i = 0; i < layout.rackCount; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    racks.push({
      id: rackLetter(i),
      name: `Rack ${rackLetter(i)}`,
      category: categoryCycle[i % categoryCycle.length],
      x: col === 0 ? 1 : 6,
      y: 1 + row * 2.4,
    });
  }
  const locations: Location[] = racks.flatMap((r) =>
    Array.from({ length: layout.levels }, (_, li) => li + 1).flatMap((level) =>
      Array.from({ length: layout.positionsPerLevel }, (_, pi) => pi + 1).map((pos) => ({
        id: `${r.id}-${String(level).padStart(2, '0')}-${String(pos).padStart(2, '0')}`,
        rack: r.id,
        level,
        pos,
        capacity: layout.capacityPerCell,
        category: r.category,
      })),
    ),
  );
  return {
    racks,
    locations,
    totalCells: locations.length,
    layout,
  };
}

export function getWarehouseGeometry(s: AppState) {
  const w = activeWarehouse(s);
  return buildWarehouseGeometry(normalizeLayout(w?.layout ?? { racks: w?.racks }));
}

export function validateLayoutForWarehouse(s: AppState, warehouseId: string, layout: WarehouseLayout) {
  const geo = buildWarehouseGeometry(layout);
  const validIds = new Set(geo.locations.map((l) => l.id));
  const orphan = s.lots.filter(
    (l) => (l.warehouseId ?? 'WH-QT-01') === warehouseId && !validIds.has(l.loc),
  );
  if (orphan.length) {
    throw new Error(
      `Hay stock en ${orphan.length} ubicación(es) que quedarían fuera del nuevo diseño. Reduce racks/niveles/casillas o mueve el inventario.`,
    );
  }
}
