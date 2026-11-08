import { reserved, scopedLots } from '../../shared/lib/inventory';
import type { AppState, Lot, Product } from '../../shared/types';

export type InventoryRow = {
  product: Product;
  stock: number;
  reserved: number;
  available: number;
  locations: string[];
  lots: Lot[];
  status: 'healthy' | 'low' | 'unavailable';
  shortage: number;
  stockValue: number;
};

export type InventoryFilter = 'all' | 'attention' | 'low' | 'unavailable' | 'reserved' | 'healthy';
export type InventorySort = 'attention' | 'name' | 'stock-desc' | 'available-asc' | 'value-desc';

export type InventoryFilters = {
  query?: string;
  category?: string;
  supplier?: string;
  status?: InventoryFilter;
  sort?: InventorySort;
};

export const inventoryStatusLabels: Record<InventoryRow['status'], string> = {
  healthy: 'Disponible',
  low: 'Bajo mínimo',
  unavailable: 'Sin disponibilidad',
};

const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });
const statusPriority = { unavailable: 0, low: 1, healthy: 2 };

export function buildInventoryRows(state: AppState): InventoryRow[] {
  const lotsByProduct = new Map<string, Lot[]>();
  for (const lot of scopedLots(state)) {
    if (lot.qty <= 0) continue;
    const lots = lotsByProduct.get(lot.productId) ?? [];
    lots.push(lot);
    lotsByProduct.set(lot.productId, lots);
  }

  return state.products.map((product) => {
    const lots = lotsByProduct.get(product.id) ?? [];
    const stock = lots.reduce((total, lot) => total + lot.qty, 0);
    // Orders currently reserve stock globally; retain that domain convention.
    const reservedQty = reserved(state, product.id);
    const available = stock - reservedQty;
    return {
      product,
      stock,
      reserved: reservedQty,
      available,
      locations: [...new Set(lots.map((lot) => lot.loc))].sort(collator.compare),
      lots,
      status: available <= 0 ? 'unavailable' : available < product.min ? 'low' : 'healthy',
      shortage: Math.max(0, product.min - available),
      stockValue: stock * product.price,
    };
  });
}

const normalizeSearch = (value: string) =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim();

const byName = (a: InventoryRow, b: InventoryRow) =>
  collator.compare(a.product.name, b.product.name) ||
  collator.compare(a.product.id, b.product.id) ||
  (a.product.id < b.product.id ? -1 : a.product.id > b.product.id ? 1 : 0);

export function filterInventoryRows(rows: InventoryRow[], filters: InventoryFilters = {}): InventoryRow[] {
  const { query = '', category = '', supplier = '', status = 'all', sort = 'attention' } = filters;
  const tokens = normalizeSearch(query).split(/\s+/).filter(Boolean);
  return rows.filter((row) => {
    if (category && row.product.category !== category) return false;
    if (supplier && row.product.supplier !== supplier) return false;
    if (status === 'attention' && row.status === 'healthy') return false;
    if (status === 'reserved' && row.reserved <= 0) return false;
    if (status !== 'all' && status !== 'attention' && status !== 'reserved' && row.status !== status) return false;
    if (!tokens.length) return true;
    const searchable = normalizeSearch([
      row.product.name,
      row.product.id,
      row.product.sku,
      row.product.supplier,
      row.product.category,
      ...row.locations,
    ].join(' '));
    return tokens.every((token) => searchable.includes(token));
  }).sort((a, b) => {
    switch (sort) {
      case 'attention':
        return statusPriority[a.status] - statusPriority[b.status] || b.shortage - a.shortage || byName(a, b);
      case 'stock-desc':
        return b.stock - a.stock || byName(a, b);
      case 'available-asc':
        return a.available - b.available || byName(a, b);
      case 'value-desc':
        return b.stockValue - a.stockValue || byName(a, b);
      default:
        return byName(a, b);
    }
  });
}
