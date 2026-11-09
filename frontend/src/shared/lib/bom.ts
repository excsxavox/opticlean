import type { AppState, Product, ProductComponent } from '../types';
import { available, product } from './inventory';

export const isRaw = (p: Product) => (p.kind ?? 'finished') === 'raw';
export const isFinished = (p: Product) => !isRaw(p);

export const componentsOf = (p: Product): ProductComponent[] =>
  (p.components ?? []).filter((c) => c.productId && Number(c.qty) > 0);

export function parentsOf(state: AppState, childId: string): Product[] {
  return state.products.filter((p) => componentsOf(p).some((c) => c.productId === childId));
}

export type BomChildStatus = {
  product: Product;
  qtyPerUnit: number;
  available: number;
  min: number;
  status: 'ok' | 'low' | 'critical';
  coverage: number;
  buildable: number;
};

export function childrenStatus(state: AppState, parent: Product): BomChildStatus[] {
  return componentsOf(parent).map((c) => {
    const child = product(state, c.productId);
    if (!child) {
      return {
        product: { id: c.productId, sku: c.productId, name: c.productId, category: '—', supplier: '—', price: 0, min: 0, weight: 0, volume: 0, kind: 'raw' },
        qtyPerUnit: c.qty,
        available: 0,
        min: 0,
        status: 'critical' as const,
        coverage: 0,
        buildable: 0,
      };
    }
    const avail = available(state, child.id);
    const coverage = child.min > 0 ? Math.max(0, Math.min(100, (avail / child.min) * 100)) : 100;
    const status = avail <= 0 ? 'critical' : avail < child.min ? 'low' : 'ok';
    return {
      product: child,
      qtyPerUnit: c.qty,
      available: avail,
      min: child.min,
      status,
      coverage,
      buildable: c.qty > 0 ? Math.floor(avail / c.qty) : 0,
    };
  });
}

export type LineSummary = {
  category: string;
  total: number;
  low: number;
  ok: number;
  samples: Array<{ id: string; name: string; available: number; status: 'ok' | 'low' | 'critical' }>;
};

export function summarizeByLine(state: AppState, rows: Array<{ product: Product; available: number; status: string }>): LineSummary[] {
  const map = new Map<string, LineSummary>();
  for (const row of rows) {
    if (isRaw(row.product)) continue;
    const cat = row.product.category || 'General';
    const bucket = map.get(cat) ?? { category: cat, total: 0, low: 0, ok: 0, samples: [] };
    bucket.total += 1;
    const st = row.status === 'healthy' ? 'ok' : row.available <= 0 ? 'critical' : 'low';
    if (st === 'ok') bucket.ok += 1;
    else bucket.low += 1;
    if (bucket.samples.length < 4) {
      bucket.samples.push({
        id: row.product.id,
        name: row.product.name,
        available: row.available,
        status: st,
      });
    }
    map.set(cat, bucket);
  }
  return [...map.values()].sort((a, b) => a.category.localeCompare(b.category, 'es'));
}
