import type { Location, Rack, WarehouseLayout } from '../types';

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

const CATEGORY_CYCLE = ['Hogar', 'Industrial', 'Institucional', 'Hospitalaria'];

export function buildWarehouseGeometry(layout: WarehouseLayout) {
  const cols = 2;
  const racks: Rack[] = [];
  for (let i = 0; i < layout.rackCount; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    racks.push({
      id: rackLetter(i),
      name: `Rack ${rackLetter(i)}`,
      category: CATEGORY_CYCLE[i % CATEGORY_CYCLE.length],
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
  return { racks, locations, totalCells: locations.length, layout };
}

export function layoutSummary(layout: WarehouseLayout) {
  const geo = buildWarehouseGeometry(layout);
  return {
    ...geo,
    capacityUnits: geo.totalCells * layout.capacityPerCell,
  };
}
