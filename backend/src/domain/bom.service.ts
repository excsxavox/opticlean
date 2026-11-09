import type { AppState, Product, ProductComponent, ProductKind } from './types.js';

const DEFAULT_WH = 'WH-QT-01';

const productOf = (s: AppState, id: string) => s.products.find((p) => p.id === id);

const availableOf = (s: AppState, id: string) => {
  const wid = s.settings.activeWarehouseId ?? s.warehouses[0]?.id ?? DEFAULT_WH;
  const stock = s.lots
    .filter((l) => (l.warehouseId ?? DEFAULT_WH) === wid && l.productId === id)
    .reduce((n, l) => n + l.qty, 0);
  const reserved = s.orders
    .filter((o) => o.status === 'Por preparar')
    .reduce(
      (n, o) => n + o.lines.filter((l) => l.productId === id).reduce((a, l) => a + l.qty, 0),
      0,
    );
  return stock - reserved;
};

export const isRaw = (p: Product) => (p.kind ?? 'finished') === 'raw';

export const componentsOf = (p: Product): ProductComponent[] =>
  (p.components ?? []).filter((c) => c.productId && Number(c.qty) > 0);

/** Productos padre que usan este insumo. */
export function parentsOf(s: AppState, childId: string): Product[] {
  return s.products.filter((p) => componentsOf(p).some((c) => c.productId === childId));
}

export function validateComponents(s: AppState, parentId: string, components: ProductComponent[] = []) {
  const seen = new Set<string>();
  for (const c of components) {
    if (!c.productId) throw new Error('Cada componente necesita un producto.');
    if (c.productId === parentId) throw new Error('Un producto no puede ser componente de sí mismo.');
    if (!Number.isFinite(c.qty) || c.qty <= 0) throw new Error('La cantidad del componente debe ser mayor que 0.');
    if (!productOf(s, c.productId)) throw new Error(`Componente no encontrado: ${c.productId}`);
    if (seen.has(c.productId)) throw new Error(`Componente duplicado: ${c.productId}`);
    seen.add(c.productId);
    const child = productOf(s, c.productId)!;
    if (componentsOf(child).some((x) => x.productId === parentId)) {
      throw new Error(`Ciclo detectado: ${c.productId} ya usa a ${parentId} como componente.`);
    }
  }
}

export type BomAlert = {
  parentId: string;
  parentName: string;
  childId: string;
  childName: string;
  qtyPerUnit: number;
  childAvailable: number;
  childMin: number;
  buildable: number;
  reason: 'child_low' | 'blocks_parent';
};

/**
 * Alertas de reposición por estructura padre→hijo:
 * - insumo bajo mínimo
 * - insumo insuficiente para cubrir el mínimo del padre
 */
export function bomReplenishmentAlerts(s: AppState): BomAlert[] {
  const alerts: BomAlert[] = [];
  for (const parent of s.products) {
    const comps = componentsOf(parent);
    if (!comps.length) continue;
    const parentGap = Math.max(parent.min, 1);
    for (const c of comps) {
      const child = productOf(s, c.productId);
      if (!child) continue;
      const childAvail = availableOf(s, child.id);
      const needForParentMin = c.qty * parentGap;
      const buildable = c.qty > 0 ? Math.floor(childAvail / c.qty) : 0;
      if (childAvail < child.min) {
        alerts.push({
          parentId: parent.id,
          parentName: parent.name,
          childId: child.id,
          childName: child.name,
          qtyPerUnit: c.qty,
          childAvailable: childAvail,
          childMin: child.min,
          buildable,
          reason: 'child_low',
        });
      } else if (childAvail < needForParentMin) {
        alerts.push({
          parentId: parent.id,
          parentName: parent.name,
          childId: child.id,
          childName: child.name,
          qtyPerUnit: c.qty,
          childAvailable: childAvail,
          childMin: child.min,
          buildable,
          reason: 'blocks_parent',
        });
      }
    }
  }
  const map = new Map<string, BomAlert>();
  for (const a of alerts) map.set(`${a.parentId}:${a.childId}:${a.reason}`, a);
  return [...map.values()].sort((a, b) => a.childAvailable - b.childAvailable);
}

export function normalizeProductBom(p: Product): Product {
  const components = componentsOf(p).map((c) => ({
    productId: String(c.productId).trim().toUpperCase(),
    qty: Number(c.qty),
  }));
  const kind: ProductKind = p.kind === 'raw' ? 'raw' : 'finished';
  return { ...p, kind, components };
}
