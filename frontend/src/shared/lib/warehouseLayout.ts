import type { Location, LocationFace, Rack, WarehouseLayout } from '../types';
import { normalizeRackPositions, rackPositions } from './rackPositioning';

export const DEFAULT_LAYOUT: WarehouseLayout = {
  rackCount: 6,
  levels: 3,
  positionsPerLevel: 4,
  capacityPerCell: 60,
  depthFaces: 1,
};

function clamp(n: number, min: number, max: number) {
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : min;
}

export function layoutFaces(layout: WarehouseLayout): (LocationFace | undefined)[] {
  return layout.depthFaces === 2 ? ['D', 'T'] : [undefined];
}

export function formatLocationId(rack: string, level: number, pos: number, face?: LocationFace) {
  const base = `${rack}-${String(level).padStart(2, '0')}-${String(pos).padStart(2, '0')}`;
  return face ? `${base}-${face}` : base;
}

export function faceLabel(face?: LocationFace) {
  if (face === 'D') return 'Delantera';
  if (face === 'T') return 'Trasera';
  return '';
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

const CATEGORY_CYCLE = ['Hogar', 'Industrial', 'Institucional', 'Hospitalaria'];

export function buildWarehouseGeometry(layout: WarehouseLayout) {
  const positions = rackPositions(layout);
  const racks: Rack[] = [];
  for (let i = 0; i < layout.rackCount; i++) {
    const { column, row } = positions[i];
    racks.push({
      id: rackLetter(i),
      name: `Rack ${rackLetter(i)}`,
      category: CATEGORY_CYCLE[i % CATEGORY_CYCLE.length],
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
  return { racks, locations, totalCells: locations.length, layout };
}

export function layoutSummary(layout: WarehouseLayout) {
  const geo = buildWarehouseGeometry(layout);
  return {
    ...geo,
    capacityUnits: geo.totalCells * layout.capacityPerCell,
  };
}

export function locationsForRack(rackId: string, locations: Location[]) {
  return locations
    .filter((l) => l.rack === rackId)
    .sort((a, b) => a.level - b.level || a.pos - b.pos || (a.face === 'T' ? 1 : 0));
}
