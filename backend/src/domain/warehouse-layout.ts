import type { AppState, Location, LocationFace, Rack, WarehouseLayout } from './types.js';
import { activeWarehouse } from './warehouse-admin.service.js';
import { categories } from './warehouse.js';
import { normalizeRackPositions } from './rack-positioning.js';

export const DEFAULT_LAYOUT: WarehouseLayout = {
  rackCount: 6,
  levels: 3,
  positionsPerLevel: 4,
  capacityPerCell: 60,
  depthFaces: 1,
};

export function layoutFaces(layout: WarehouseLayout): (LocationFace | undefined)[] {
  return layout.depthFaces === 2 ? ['D', 'T'] : [undefined];
}

export function formatLocationId(rack: string, level: number, pos: number, face?: LocationFace) {
  const base = `${rack}-${String(level).padStart(2, '0')}-${String(pos).padStart(2, '0')}`;
  return face ? `${base}-${face}` : base;
}

const SINGLE_LOC_ID = /^[A-Z]-\d{2}-\d{2}$/;

/** Convierte ubicación simple a cara delantera al activar doble profundidad. */
export function toDelanteraLocId(loc: string): string {
  if (loc.endsWith('-D') || loc.endsWith('-T')) return loc;
  return SINGLE_LOC_ID.test(loc) ? `${loc}-D` : loc;
}

export function isSingleFaceLocId(loc: string): boolean {
  return SINGLE_LOC_ID.test(loc);
}

function clamp(n: number, min: number, max: number) {
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : min;
}

export function normalizeLayout(input?: Partial<WarehouseLayout> & { racks?: number }): WarehouseLayout {
  const rackCount = clamp(input?.rackCount ?? input?.racks ?? DEFAULT_LAYOUT.rackCount, 1, 12);
  return {
    rackCount,
    levels: clamp(input?.levels ?? DEFAULT_LAYOUT.levels, 1, 5),
    positionsPerLevel: clamp(input?.positionsPerLevel ?? DEFAULT_LAYOUT.positionsPerLevel, 1, 8),
    capacityPerCell: clamp(input?.capacityPerCell ?? DEFAULT_LAYOUT.capacityPerCell, 10, 200),
    depthFaces: input?.depthFaces === 2 ? 2 : 1,
    ...(input?.rackPositions !== undefined ? { rackPositions: normalizeRackPositions(rackCount, input.rackPositions) } : {}),
  };
}

function rackLetter(index: number) {
  return String.fromCharCode(65 + index);
}

export function buildWarehouseGeometry(layout: WarehouseLayout) {
  const positions = normalizeRackPositions(layout.rackCount, layout.rackPositions);
  const categoryCycle = [...categories];
  const racks: Rack[] = [];
  for (let i = 0; i < layout.rackCount; i++) {
    const { column, row } = positions[i];
    racks.push({
      id: rackLetter(i),
      name: `Rack ${rackLetter(i)}`,
      category: categoryCycle[i % categoryCycle.length],
      x: 1 + column * 5,
      y: 1 + row * 2.4,
    });
  }
  const faces = layoutFaces(layout);
  const locations: Location[] = racks.flatMap((r) =>
    Array.from({ length: layout.levels }, (_, li) => li + 1).flatMap((level) =>
      Array.from({ length: layout.positionsPerLevel }, (_, pi) => pi + 1).flatMap((pos) =>
        faces.map((face) => ({
          id: formatLocationId(r.id, level, pos, face),
          rack: r.id,
          level,
          pos,
          capacity: layout.capacityPerCell,
          category: r.category,
          ...(face ? { face } : {}),
        })),
      ),
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
