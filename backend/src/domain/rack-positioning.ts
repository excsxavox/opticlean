import type { RackPosition } from './types.js';

export const FLOOR_COLUMNS = 4;
export const FLOOR_ROWS = 6;

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

export function validateRackPositions(rackCount: number, input: unknown) {
  if (input === undefined) return;
  if (!Array.isArray(input)) throw new Error('La distribución debe contener una lista de posiciones de racks.');
  const ids = new Set(Array.from({ length: rackCount }, (_, index) => String.fromCharCode(65 + index)));
  const seen = new Set<string>();
  const occupied = new Set<string>();
  for (const position of input) {
    if (!position || !ids.has(position.rackId) || seen.has(position.rackId)) throw new Error('La distribución contiene un rack repetido o que no pertenece a esta bodega.');
    if (!Number.isInteger(position.column) || position.column < 0 || position.column >= FLOOR_COLUMNS ||
      !Number.isInteger(position.row) || position.row < 0 || position.row >= FLOOR_ROWS) throw new Error('Coloca los racks dentro de las 4 columnas y 6 filas del plano.');
    const key = `${position.column}:${position.row}`;
    if (occupied.has(key)) throw new Error('Dos racks no pueden ocupar el mismo espacio. Mueve uno a un espacio libre.');
    seen.add(position.rackId);
    occupied.add(key);
  }
}
