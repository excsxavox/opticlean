import type { AppState, Lot } from '../../../shared/types';
import { scopedLots } from '../../../shared/lib/inventory';
import type { VisualLayout, VisualLocation } from './types';
import { locId } from './layout';

/** Lotes que pertenecen a una ubicación visual A-01-01 (incluye caras A-01-01-D / T). */
export function lotsAtVisual(state: AppState, visualLoc: string): Lot[] {
  return scopedLots(state).filter(
    (l) => l.qty > 0 && (l.loc === visualLoc || l.loc.startsWith(`${visualLoc}-`)),
  );
}

export function qtyAtVisual(state: AppState, visualLoc: string): number {
  return lotsAtVisual(state, visualLoc).reduce((n, l) => n + l.qty, 0);
}

/** Preferir la ubicación API concreta (con cara) para traslados/recepción. */
export function apiLocForVisual(state: AppState, visualLoc: string): string {
  const lots = lotsAtVisual(state, visualLoc);
  if (lots[0]) return lots[0].loc;
  const exact = scopedLots(state).find((l) => l.loc === visualLoc);
  if (exact) return visualLoc;
  return `${visualLoc}-D`;
}

export function daysToExpiry(expiry: string, now = new Date()): number | null {
  if (!expiry) return null;
  return Math.ceil((new Date(expiry).getTime() - now.getTime()) / 864e5);
}

export function locDays(state: AppState, visualLoc: string): number | null {
  const days = lotsAtVisual(state, visualLoc)
    .map((l) => daysToExpiry(l.expiry))
    .filter((d): d is number => d !== null);
  return days.length ? Math.min(...days) : null;
}

export function expColor(days: number | null): string {
  if (days === null) return '#f6f9fc';
  if (days <= 30) return '#e7b0b0';
  if (days <= 90) return '#f0d39a';
  return '#b7d9c8';
}

export function buildVisualLocations(layout: VisualLayout): VisualLocation[] {
  return layout.floors.flatMap((f) =>
    f.racks.flatMap((r) => {
      const cells: VisualLocation[] = [];
      for (let level = 1; level <= r.levels; level++) {
        for (let pos = 1; pos <= r.cols; pos++) {
          cells.push({
            id: locId(r.id, level, pos),
            rack: r.id,
            level,
            pos,
            floor: f.id,
            capacity: r.capacity || 60,
            category: r.category,
          });
        }
      }
      return cells;
    }),
  );
}
