import type { RackPosition, WarehouseLayout } from '../types';

export const FLOOR_COLUMNS = 4;
export const FLOOR_ROWS = 6;

/** Fill unpositioned racks without displacing positions already assigned. */
export function normalizeRackPositions(rackCount: number, input: unknown): RackPosition[] {
  const ids = Array.from({ length: rackCount }, (_, index) => String.fromCharCode(65 + index));
  const chosen = new Map<string, RackPosition>();
  const occupied = new Set<string>();
  for (const position of Array.isArray(input) ? input : []) {
    if (!position || !ids.includes(position.rackId) || chosen.has(position.rackId) ||
      !Number.isInteger(position.column) || position.column < 0 || position.column >= FLOOR_COLUMNS ||
      !Number.isInteger(position.row) || position.row < 0 || position.row >= FLOOR_ROWS) continue;
    const key = `${position.column}:${position.row}`;
    if (occupied.has(key)) continue;
    chosen.set(position.rackId, { rackId: position.rackId, column: position.column, row: position.row });
    occupied.add(key);
  }
  return ids.map((rackId, index) => {
    const existing = chosen.get(rackId);
    if (existing) return existing;
    const preferred = { column: index % 2, row: Math.floor(index / 2) };
    const candidates = [preferred, ...Array.from({ length: FLOOR_COLUMNS * FLOOR_ROWS }, (_, cell) => ({ column: cell % FLOOR_COLUMNS, row: Math.floor(cell / FLOOR_COLUMNS) }))];
    const free = candidates.find((cell) => !occupied.has(`${cell.column}:${cell.row}`))!;
    occupied.add(`${free.column}:${free.row}`);
    return { rackId, ...free };
  });
}

export function rackPositions(layout: WarehouseLayout) {
  return normalizeRackPositions(layout.rackCount, layout.rackPositions);
}

/** Dropping onto another rack swaps both positions, retaining every rack. */
export function moveRack(layout: WarehouseLayout, rackId: string, column: number, row: number): WarehouseLayout {
  if (!Number.isInteger(column) || !Number.isInteger(row) || column < 0 || column >= FLOOR_COLUMNS || row < 0 || row >= FLOOR_ROWS) return layout;
  const positions = rackPositions(layout);
  const source = positions.find((position) => position.rackId === rackId);
  if (!source) return layout;
  return { ...layout, rackPositions: positions.map((position) => {
    if (position.rackId === rackId) return { ...position, column, row };
    if (position.column === column && position.row === row) return { ...position, column: source.column, row: source.row };
    return position;
  }) };
}
