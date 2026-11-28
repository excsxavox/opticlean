import type { AppState, Lot, Order, OrderKit, OrderLine } from '../types';

export const activeWarehouseId = (s: AppState) =>
  s.settings.activeWarehouseId ?? s.warehouses?.[0]?.id ?? 'WH-QT-01';

export const scopedLots = (s: AppState) =>
  s.lots.filter((l) => (l.warehouseId ?? 'WH-QT-01') === activeWarehouseId(s));

export function lotsForScope(s: AppState, warehouseId: string | 'all') {
  if (warehouseId === 'all') return s.lots;
  return s.lots.filter((lot) => (lot.warehouseId ?? 'WH-QT-01') === warehouseId);
}

const HELD_LOCS = new Set(['CUARENTENA', 'TRANSITO']);

export const stock = (s: AppState, id: string) =>
  scopedLots(s)
    .filter((l) => l.productId === id && !HELD_LOCS.has(l.loc))
    .reduce((n, l) => n + l.qty, 0);

export function expandedDemand(s: AppState, order: { lines: OrderLine[]; kits?: OrderKit[] }): OrderLine[] {
  const map = new Map<string, number>();
  for (const line of order.lines) map.set(line.productId, (map.get(line.productId) ?? 0) + line.qty);
  for (const kit of order.kits ?? []) {
    const bundle = (s.bundles ?? []).find((item) => item.id === kit.bundleId);
    for (const line of bundle?.lines ?? []) {
      map.set(line.productId, (map.get(line.productId) ?? 0) + line.qty * kit.qty);
    }
  }
  return [...map.entries()].map(([productId, qty]) => ({ productId, qty }));
}

export function bundlePrice(s: AppState, bundleId: string) {
  const bundle = (s.bundles ?? []).find((item) => item.id === bundleId);
  if (!bundle) return 0;
  if (bundle.price != null && Number.isFinite(bundle.price)) return bundle.price;
  return bundle.lines.reduce((n, line) => n + line.qty * (product(s, line.productId)?.price ?? 0), 0);
}

export const reserved = (s: AppState, id: string) =>
  s.orders
    .filter((o) => o.status === 'Por preparar')
    .reduce((n, o) => n + expandedDemand(s, o).filter((l) => l.productId === id).reduce((a, l) => a + l.qty, 0), 0);

/** Fecha de hoy en Ecuador (YYYY-MM-DD). */
export const todayEc = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guayaquil' });

export function daysUntil(expiry: string, today = todayEc()) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(expiry ?? '')) return null;
  return Math.round((Date.parse(`${expiry.slice(0, 10)}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 864e5);
}

/** Misma regla que el backend: vendible, sin retención, no vencido y con vida útil mínima. */
export function isLotSellable(s: AppState, lot: Lot, today = todayEc()) {
  if (HELD_LOCS.has(lot.loc) || lot.onHold || lot.qty <= 0) return false;
  const item = product(s, lot.productId);
  if (item?.perishable === false) return true;
  const days = daysUntil(lot.expiry, today);
  if (days == null || days < 0) return false;
  return days >= (item?.minShelfLifeDays ?? 0);
}

export const sellableStock = (s: AppState, id: string) =>
  scopedLots(s)
    .filter((l) => l.productId === id && isLotSellable(s, l))
    .reduce((n, l) => n + l.qty, 0);

export const available = (s: AppState, id: string) => sellableStock(s, id) - reserved(s, id);

const heldLoc = (loc: string) => HELD_LOCS.has(loc);

export function stockIn(s: AppState, id: string, warehouseId: string | 'all') {
  return lotsForScope(s, warehouseId)
    .filter((lot) => lot.productId === id && !heldLoc(lot.loc))
    .reduce((n, lot) => n + lot.qty, 0);
}

export function sellableIn(s: AppState, id: string, warehouseId: string | 'all') {
  return lotsForScope(s, warehouseId)
    .filter((lot) => lot.productId === id && isLotSellable(s, lot))
    .reduce((n, lot) => n + lot.qty, 0);
}

export function availableIn(s: AppState, id: string, warehouseId: string | 'all') {
  return sellableIn(s, id, warehouseId) - reserved(s, id);
}

/** FEFO: vence antes primero. Sin fecha va al final. Empate por ingreso. */
function expiryKey(expiry?: string) {
  return /^\d{4}-\d{2}-\d{2}/.test(expiry ?? '') ? expiry!.slice(0, 10) : '9999-12-31';
}

export const fefoCompare = (a: Lot, b: Lot) =>
  expiryKey(a.expiry).localeCompare(expiryKey(b.expiry)) ||
  (a.receivedAt ?? '').localeCompare(b.receivedAt ?? '') ||
  a.loc.localeCompare(b.loc);

/** Lotes vendibles de un producto en orden de salida (1 = sale primero). */
export const exitOrder = (s: AppState, productId: string) =>
  scopedLots(s)
    .filter((l) => l.productId === productId && isLotSellable(s, l))
    .sort(fefoCompare);

/** Urgencia por días al vencimiento, para colorear. */
export const expiryTone = (days: number | null) =>
  days == null ? '' : days < 0 ? 'red' : days < 60 ? 'red' : days < 120 ? 'amber' : 'green';

export const qtyAt = (s: AppState, loc: string) =>
  scopedLots(s)
    .filter((l) => l.loc === loc)
    .reduce((n, l) => n + l.qty, 0);

export const product = (s: AppState, id: string) => s.products.find((p) => p.id === id);

export const client = (s: AppState, id: string) => s.clients.find((c) => c.id === id);

export const orderValue = (s: AppState, o: { lines: OrderLine[]; kits?: OrderKit[] }) =>
  o.lines.reduce((n, l) => n + l.qty * (l.unitPrice ?? product(s, l.productId)?.price ?? 0), 0) +
  (o.kits ?? []).reduce((n, kit) => n + kit.qty * bundlePrice(s, kit.bundleId), 0);

export const orderWeight = (s: AppState, o: Order) =>
  expandedDemand(s, o).reduce((n, l) => n + l.qty * (product(s, l.productId)?.weight ?? 0), 0);

const measuredParcels = (s: AppState, o: Order) =>
  o.packing ? (s.parcels ?? []).filter((parcel) => parcel.orderId === o.id) : [];

/** kg del pedido: lo pesado en sus bultos si el empaque está cerrado; si no, el catálogo. */
export const orderLoadKg = (s: AppState, o: Order) => {
  const parcels = measuredParcels(s, o);
  return parcels.length ? parcels.reduce((n, p) => n + p.weightKg, 0) : orderWeight(s, o);
};

/** m³ del pedido, con el mismo criterio que `orderLoadKg`. */
export const orderLoadM3 = (s: AppState, o: Order) => {
  const parcels = measuredParcels(s, o);
  return parcels.length
    ? parcels.reduce((n, p) => n + p.volumeM3, 0)
    : expandedDemand(s, o).reduce((n, l) => n + l.qty * (product(s, l.productId)?.volume ?? 0), 0) / 1000;
};

export const money = (n: number) =>
  new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' }).format(n);

const CREDIT_STATUSES = new Set(['Esperando stock', 'Por preparar', 'Preparado', 'En ruta', 'Incidencia']);

/** Crédito usado = pedidos abiertos que aún no tienen factura. */
export const creditUsed = (s: AppState, clientId: string) => {
  const invoiced = new Set((s.invoices ?? []).filter((invoice) => invoice.status === 'Emitida').map((invoice) => invoice.orderId));
  return s.orders
    .filter((o) => o.clientId === clientId && CREDIT_STATUSES.has(o.status) && !o.id.startsWith('PED-H') && !invoiced.has(o.id))
    .reduce((n, o) => n + orderValue(s, o), 0);
};

export function invoiceBalance(s: AppState, invoiceId: string) {
  const invoice = (s.invoices ?? []).find((item) => item.id === invoiceId);
  if (!invoice || invoice.status !== 'Emitida') return 0;
  const credited = (s.creditNotes ?? [])
    .filter((note) => note.invoiceId === invoiceId && note.status === 'Emitida')
    .reduce((n, note) => n + note.total, 0);
  const paid = (s.customerPayments ?? []).filter((payment) => payment.invoiceId === invoiceId).reduce((n, payment) => n + payment.amount, 0);
  return Math.max(0, Math.round((invoice.total - credited - paid) * 100) / 100);
}

export function outstandingReceivable(s: AppState, clientId: string) {
  return (s.invoices ?? [])
    .filter((invoice) => invoice.clientId === clientId && invoice.status === 'Emitida')
    .reduce((n, invoice) => n + invoiceBalance(s, invoice.id), 0);
}

export const creditLimitOf = (s: AppState, clientId: string) =>
  client(s, clientId)?.creditLimit ?? 0;

export const creditAvailable = (s: AppState, clientId: string) =>
  Math.max(0, creditLimitOf(s, clientId) - creditUsed(s, clientId) - outstandingReceivable(s, clientId));

export const num = (n: number) => new Intl.NumberFormat('es-EC').format(n);

export const dateShort = (d: string) =>
  new Date(d.length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('es-EC', {
    day: '2-digit',
    month: 'short',
    timeZone: 'America/Guayaquil',
  });

export const time = (d: string) =>
  new Date(d).toLocaleTimeString('es-EC', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Guayaquil',
  });

export const statusColor = (s: string) =>
  ({
    'Esperando stock': 'purple',
    'Por preparar': 'amber',
    Preparado: 'blue',
    'En ruta': 'purple',
    Entregado: 'green',
    Incidencia: 'red',
    Solicitada: 'blue',
    Abierta: 'blue',
    Parcial: 'amber',
    Recibida: 'green',
    Cerrada: 'green',
    Cancelada: 'red',
    Cancelado: 'red',
  })[s] ?? '';
