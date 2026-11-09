import { familyOf } from './families.service.js';
import { product, qtyAt } from './inventory.service.js';
import type { AppState, Location } from './types.js';
import { lotsForActiveWarehouse } from './warehouse-admin.service.js';
import { getWarehouseGeometry } from './warehouse-layout.js';

export type PlacementSuggestion = Location & {
  score: number;
  free: number;
  reasons: string[];
  familyMatch: boolean;
  fragileSafe: boolean;
  isEmpty: boolean;
  consolidates: boolean;
};

/**
 * Guía de ubicación (IA operativa):
 * vacíos, familia de bodega, frágil y consolidación del mismo SKU.
 */
export function suggestPlacement(
  s: AppState,
  productId: string,
  qty = 1,
  exclude = '',
): PlacementSuggestion[] {
  const p = product(s, productId);
  if (!p) return [];
  const family = familyOf(s, p);
  const fragile = !!p.fragile;
  const lots = lotsForActiveWarehouse(s);

  const scored = getWarehouseGeometry(s)
    .locations.filter((l) => {
      if (l.id === exclude) return false;
      if (qtyAt(s, l.id) + qty > l.capacity) return false;
      return lots.filter((t) => t.loc === l.id).every((t) => t.productId === productId);
    })
    .map((l) => {
      const occupied = qtyAt(s, l.id);
      const free = l.capacity - occupied;
      const isEmpty = occupied === 0;
      const consolidates = lots.some((t) => t.loc === l.id && t.productId === productId);
      const familyMatch = !!family?.rackIds.includes(l.rack);
      const categoryMatch = l.category === p.category;
      const fragileSafe = fragile ? l.level <= 2 : true;
      const inFragileFamilyRack = !!family?.fragilePreferred && family.rackIds.includes(l.rack);

      let score = 0;
      const reasons: string[] = [];

      if (familyMatch) {
        score += 120;
        reasons.push(`Familia ${family!.name} (rack ${l.rack})`);
      } else if (categoryMatch) {
        score += 70;
        reasons.push(`Misma línea ${p.category}`);
      } else {
        score += 5;
        reasons.push('Zona alternativa disponible');
      }

      if (consolidates) {
        score += 55;
        reasons.push('Consolida con el mismo producto');
      } else if (isEmpty) {
        score += 40;
        reasons.push('Ubicación vacía');
      }

      if (fragile) {
        if (fragileSafe) {
          score += 45;
          reasons.push(`Nivel ${l.level} seguro para frágil`);
        } else {
          score -= 35;
          reasons.push(`Nivel ${l.level} alto · riesgo para frágil`);
        }
        if (inFragileFamilyRack || familyMatch) {
          score += 20;
        }
      } else if (l.level === 1) {
        score += 8;
      }

      // Preferir más hueco libre (vacíos parciales)
      score += Math.min(25, Math.floor((free / Math.max(l.capacity, 1)) * 25));
      if (free >= qty * 2) {
        score += 10;
        reasons.push(`${free} uds. libres`);
      }

      // Cara delantera un poco preferida para acceso
      if (l.face === 'D' || !l.face) score += 4;

      return {
        ...l,
        score,
        free,
        reasons: reasons.slice(0, 4),
        familyMatch,
        fragileSafe,
        isEmpty,
        consolidates,
      } satisfies PlacementSuggestion;
    })
    .sort((a, b) => b.score - a.score || b.free - a.free);

  return scored;
}

/** Compatibilidad con el endpoint histórico /api/suggest */
export function suggest(s: AppState, productId: string, qty = 1, exclude = '') {
  return suggestPlacement(s, productId, qty, exclude);
}
