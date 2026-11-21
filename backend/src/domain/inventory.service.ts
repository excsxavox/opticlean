import type { AppState, Lot, Order, OrderKit, OrderLine, OrderPick, OrderShortage, Product } from './types.js';
import { RECEIPT_REASONS } from './types.js';
import { currentActor } from './request-context.js';
import { cellFitReason } from './capacity.js';
import { activeWarehouseId, lotsForActiveWarehouse } from './warehouse-admin.service.js';
import { getWarehouseGeometry } from './warehouse-layout.js';
import { normalizeProductBom, validateComponents } from './bom.service.js';
import { placementBlockReason } from './hazard.js';
import { stockQtyFromPack } from './packs.js';
import { applyPurchaseReceipt } from './purchase-lines.js';
import { vehicleByPlate } from './fleet.service.js';
import { issueGuide } from './commercial.service.js';
import {
  QUARANTINE_LOC,
  invoicedOrderIds,
  isSellableLoc,
  outstandingReceivable,
  overdueReceivable,
  resolveUnitPrice,
} from './ledger.js';

export const uid = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export const product = (s: AppState, id: string) => s.products.find((p) => p.id === id);

export const client = (s: AppState, id: string) => s.clients.find((c) => c.id === id);

export const stock = (s: AppState, id: string) =>
  lotsForActiveWarehouse(s)
    .filter((l) => l.productId === id && isSellableLoc(l.loc))
    .reduce((n, l) => n + l.qty, 0);

function applyAverageCost(s: AppState, productId: string, qty: number, unitCost: number) {
  const item = product(s, productId);
  if (!item || !(unitCost > 0) || !(qty > 0)) return;
  const prevQty = s.lots
    .filter((lot) => lot.productId === productId && isSellableLoc(lot.loc))
    .reduce((n, lot) => n + lot.qty, 0);
  const prev = item.avgCost ?? 0;
  const base = prev > 0 ? prevQty : 0;
  item.avgCost = Math.round(((base * prev + qty * unitCost) / (base + qty)) * 10000) / 10000;
}

const CREDIT_STATUSES = new Set(['Esperando stock', 'Por preparar', 'Preparado', 'En ruta', 'Incidencia']);

export const todayGuayaquil = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guayaquil' });

export function daysUntilExpiry(expiry: string, today = todayGuayaquil()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const a = Date.parse(`${expiry}T12:00:00Z`);
  const b = Date.parse(`${today}T12:00:00Z`);
  return Math.round((a - b) / 864e5);
}

export function expandedDemand(
  s: AppState,
  order: { lines: OrderLine[]; kits?: OrderKit[] },
): OrderLine[] {
  const map = new Map<string, number>();
  for (const line of order.lines) {
    map.set(line.productId, (map.get(line.productId) ?? 0) + Number(line.qty));
  }
  for (const kit of order.kits ?? []) {
    const bundle = s.bundles?.find((b) => b.id === kit.bundleId);
    if (!bundle) continue;
    for (const line of bundle.lines) {
      map.set(line.productId, (map.get(line.productId) ?? 0) + line.qty * kit.qty);
    }
  }
  return [...map.entries()].map(([productId, qty]) => ({ productId, qty }));
}

export function bundlePrice(s: AppState, bundleId: string) {
  const bundle = s.bundles?.find((b) => b.id === bundleId);
  if (!bundle) return 0;
  if (bundle.price != null && Number.isFinite(bundle.price)) return bundle.price;
  return bundle.lines.reduce((n, line) => n + line.qty * (product(s, line.productId)?.price ?? 0), 0);
}

/** Lote que se puede vender hoy: ubicación vendible, sin retención, no vencido y con vida útil mínima. */
export function assertCanSell(s: AppState, productId: string, today = todayGuayaquil()) {
  const item = product(s, productId);
  if (!item) return;
  if (item.requiresSanitary && !item.sanitaryRegistration?.trim()) {
    throw new Error(`Falta el registro sanitario de ${item.name}.`);
  }
  if (item.sanitaryExpires && item.sanitaryExpires < today) {
    throw new Error(
      `El registro sanitario de ${item.name} está vencido${item.sanitaryRegistration ? ` (${item.sanitaryRegistration})` : ''}.`,
    );
  }
}

export function isLotSellable(s: AppState, lot: Lot, today = todayGuayaquil()) {
  if (!isSellableLoc(lot.loc) || lot.onHold || lot.qty <= 0) return false;
  const item = product(s, lot.productId);
  if (item?.perishable === false) return true;
  const days = daysUntilExpiry(lot.expiry, today);
  if (days == null || days < 0) return false;
  const minDays = item?.minShelfLifeDays ?? 0;
  return days >= minDays;
}

/** Unidades que se pueden vender hoy (excluye vencido, retenido y bajo vida útil mínima). */
export const sellableStock = (s: AppState, id: string, today = todayGuayaquil()) =>
  lotsForActiveWarehouse(s)
    .filter((l) => l.productId === id && isLotSellable(s, l, today))
    .reduce((n, l) => n + l.qty, 0);

/** Unidades físicas que no se pueden vender (vencidas, retenidas o con poca vida útil). */
export const unsellableStock = (s: AppState, id: string) => stock(s, id) - sellableStock(s, id);

export const reserved = (s: AppState, id: string) =>
  s.orders
    .filter((o) => o.status === 'Por preparar')
    .reduce((n, o) => n + expandedDemand(s, o).filter((l) => l.productId === id).reduce((a, l) => a + l.qty, 0), 0);

export const available = (s: AppState, id: string) => sellableStock(s, id) - reserved(s, id);

export const qtyAt = (s: AppState, loc: string) =>
  lotsForActiveWarehouse(s)
    .filter((l) => l.loc === loc)
    .reduce((n, l) => n + l.qty, 0);

export const orderValue = (s: AppState, o: { lines: OrderLine[]; kits?: OrderKit[] }) =>
  o.lines.reduce((n, l) => n + l.qty * (l.unitPrice ?? product(s, l.productId)?.price ?? 0), 0) +
  (o.kits ?? []).reduce((n, kit) => n + kit.qty * bundlePrice(s, kit.bundleId), 0);

export const orderWeight = (s: AppState, o: Order) =>
  expandedDemand(s, o).reduce((n, l) => n + l.qty * (product(s, l.productId)?.weight ?? 0), 0);

export const creditUsed = (s: AppState, clientId: string) => {
  const invoiced = invoicedOrderIds(s);
  return s.orders
    .filter((o) => o.clientId === clientId && CREDIT_STATUSES.has(o.status) && !o.id.startsWith('PED-H') && !invoiced.has(o.id))
    .reduce((n, o) => n + orderValue(s, o), 0);
};

export function addEvent(
  s: AppState,
  type: string,
  productId: string,
  qty: number,
  from: string,
  to: string,
  ref: string,
  batch = '',
) {
  s.events.unshift({
    id: uid('ev'),
    type,
    productId,
    qty,
    from,
    to,
    ref,
    batch,
    at: new Date().toISOString(),
    by: actorName(s),
  });
}

/** Usuario autenticado que hace la operación; el operador configurado solo fuera de una petición. */
export function actorName(s: AppState) {
  return currentActor()?.name || s.settings.operator;
}

function nextReceiptId(s: AppState) {
  const max = s.receipts.reduce((n, r) => Math.max(n, Number(r.id.replace(/\D/g, '')) || 0), 0);
  return `REC-${String(max + 1).padStart(4, '0')}`;
}

export function receive(
  s: AppState,
  data: {
    productId: string;
    qty: number | string;
    loc: string;
    batch: string;
    expiry: string;
    supplier: string;
    purchaseId?: string;
    packCode?: string;
    packQty?: number | string;
    /** Obligatorio si no hay orden de compra. */
    reason?: string;
    /** Recibir a inspección de calidad (queda retenido). */
    inspect?: boolean;
  },
) {
  const item = product(s, data.productId);
  const packQty = data.packQty != null && data.packQty !== '' ? Number(data.packQty) : null;
  const qty =
    packQty != null && data.packCode
      ? stockQtyFromPack(item, packQty, data.packCode)
      : Number(data.qty);
  const target = getWarehouseGeometry(s).locations.find((l) => l.id === data.loc);
  if (!item || !Number.isInteger(qty) || qty <= 0 || !target) {
    throw new Error('Selecciona un producto, una ubicación y una cantidad entera mayor a cero.');
  }
  const fit = cellFitReason(s, target, data.productId, qty);
  if (fit) throw new Error(fit);
  const perishable = item.perishable !== false;
  const expiry = data.expiry?.trim() ?? '';
  if (!data.batch?.trim()) throw new Error('Completa el lote.');
  if (perishable && !expiry) throw new Error('Completa el lote y la fecha de vencimiento.');
  if (expiry && expiry < todayGuayaquil()) {
    throw new Error('La fecha de vencimiento no puede estar en el pasado.');
  }
  const reason = data.reason?.trim();
  if (!data.purchaseId) {
    if (!reason) throw new Error('Sin orden de compra indica el motivo del ingreso.');
    if (!(RECEIPT_REASONS as readonly string[]).includes(reason)) {
      throw new Error(`Motivo no válido. Usa: ${RECEIPT_REASONS.join(', ')}.`);
    }
  }
  const blocked = placementBlockReason(s, data.productId, target, { expiry });
  if (blocked) throw new Error(blocked);
  let supplier = data.supplier;
  if (data.purchaseId) {
    const po = s.purchases.find((p) => p.id === data.purchaseId);
    if (!po) throw new Error('Orden de compra no encontrada.');
    const line = po.lines?.find((entry) => entry.productId === data.productId);
    if (line && line.unitPrice > 0 && line.unitsPerPack > 0) {
      applyAverageCost(s, data.productId, qty, line.unitPrice / line.unitsPerPack);
    }
    applyPurchaseReceipt(po, data.productId, qty);
    supplier = supplier || s.suppliers?.find((x) => x.id === po.supplierId)?.name || '';
  }
  const id = nextReceiptId(s);
  const receivedAt = new Date().toISOString();
  const inspect = data.inspect ?? !!item.inspectOnReceipt;
  const lotId = uid('lot');
  const batch = data.batch.trim();
  s.lots.push({
    id: lotId,
    productId: data.productId,
    qty,
    loc: data.loc,
    batch,
    expiry,
    warehouseId: activeWarehouseId(s),
    purchaseId: data.purchaseId || undefined,
    receiptId: id,
    receivedAt,
    ...(inspect ? { onHold: true } : {}),
  });
  s.receipts.unshift({
    id,
    productId: data.productId,
    qty,
    loc: data.loc,
    batch,
    expiry,
    supplier,
    purchaseId: data.purchaseId || undefined,
    reason: data.purchaseId ? undefined : reason,
    date: todayGuayaquil(),
    receivedAt,
    by: actorName(s),
    lotId,
    ...(inspect ? { inspection: 'Pendiente' as const } : {}),
  });
  addEvent(
    s,
    'Recepción',
    data.productId,
    qty,
    supplier || reason || 'Ingreso',
    data.loc,
    data.purchaseId ? `${id} · ${data.purchaseId}` : id,
    batch,
  );
  return id;
}

function receiptOfLot(s: AppState, lot: Lot) {
  return s.receipts.find((r) => r.lotId === lot.id) ?? s.receipts.find((r) => r.id === lot.receiptId);
}

/** Libera un lote retenido en inspección: pasa a ser vendible. */
export function releaseLot(s: AppState, lotId: string) {
  const lot = s.lots.find((l) => l.id === lotId);
  if (!lot || !lot.onHold) throw new Error('El lote no está en inspección.');
  delete lot.onHold;
  const receipt = receiptOfLot(s, lot);
  if (receipt) receipt.inspection = 'Liberado';
  addEvent(s, 'Inspección liberada', lot.productId, lot.qty, lot.loc, lot.loc, lot.receiptId ?? lot.id, lot.batch);
}

/** Rechaza un lote en inspección: va a cuarentena para devolverlo al proveedor. */
export function rejectLot(s: AppState, lotId: string, reason: string) {
  const lot = s.lots.find((l) => l.id === lotId);
  if (!lot || !lot.onHold) throw new Error('El lote no está en inspección.');
  const why = reason?.trim();
  if (!why) throw new Error('Indica el motivo del rechazo.');
  const from = lot.loc;
  delete lot.onHold;
  lot.loc = QUARANTINE_LOC;
  const receipt = receiptOfLot(s, lot);
  if (receipt) receipt.inspection = 'Rechazado';
  addEvent(
    s,
    'Inspección rechazada',
    lot.productId,
    lot.qty,
    from,
    QUARANTINE_LOC,
    `${lot.receiptId ?? lot.id} · ${why}`,
    lot.batch,
  );
}

export function move(
  s: AppState,
  data: { lotId: string; qty: number | string; to: string },
) {
  const lot = s.lots.find((l) => l.id === data.lotId);
  const target = getWarehouseGeometry(s).locations.find((l) => l.id === data.to);
  const qty = Number(data.qty);
  if (!lot || !target || !Number.isInteger(qty) || qty <= 0 || qty > lot.qty) {
    throw new Error('Revisa la cantidad disponible y el destino.');
  }
  if (lot.loc === data.to) throw new Error('El destino debe ser diferente al origen.');
  const fit = cellFitReason(s, target, lot.productId, qty);
  if (fit) throw new Error(fit);
  const blocked = placementBlockReason(s, lot.productId, target, { expiry: lot.expiry });
  if (blocked) throw new Error(blocked);
  const from = lot.loc;
  lot.qty -= qty;
  s.lots.push({
    ...lot,
    id: uid('lot'),
    qty,
    loc: data.to,
    receivedAt: lot.receivedAt ?? todayGuayaquil(),
  });
  s.lots = s.lots.filter((l) => l.qty > 0);
  addEvent(s, 'Traslado', lot.productId, qty, from, data.to, uid('MOV'), lot.batch);
}

export function createOrder(
  s: AppState,
  data: {
    clientId: string;
    lines?: OrderLine[];
    kits?: OrderKit[];
    priority?: string;
    notes?: string;
    /** Acepta el pedido aunque falte stock; queda Esperando stock. */
    backorder?: boolean;
    channel?: Order['channel'];
  },
) {
  const buyer = client(s, data.clientId);
  const grouped = new Map<string, number>();
  for (const l of data.lines ?? []) {
    grouped.set(l.productId, (grouped.get(l.productId) ?? 0) + Number(l.qty));
  }
  const lines = [...grouped.entries()].map(([productId, qty]) => ({ productId, qty }));
  const kits: OrderKit[] = [];
  for (const kit of data.kits ?? []) {
    const qty = Number(kit.qty);
    if (!s.bundles?.some((b) => b.id === kit.bundleId)) throw new Error('Paquete no encontrado.');
    if (!Number.isInteger(qty) || qty <= 0) throw new Error('La cantidad del paquete debe ser un entero mayor que cero.');
    const existing = kits.find((k) => k.bundleId === kit.bundleId);
    if (existing) existing.qty += qty;
    else kits.push({ bundleId: kit.bundleId, qty });
  }
  if (!buyer || (!lines.length && !kits.length)) {
    throw new Error('Selecciona un cliente y al menos un producto.');
  }
  const priced = lines.map((line) => ({
    ...line,
    unitPrice: resolveUnitPrice(s, buyer.id, line.productId, line.qty),
  }));
  const draft = { lines: priced, kits };
  const shortages: OrderShortage[] = [];
  for (const l of expandedDemand(s, draft)) {
    const item = product(s, l.productId);
    assertCanSell(s, l.productId);
    if (!item || !Number.isInteger(l.qty) || l.qty <= 0) {
      throw new Error(`Cantidad inválida para ${item?.name ?? 'el producto'}.`);
    }
    const free = Math.max(0, available(s, l.productId));
    if (l.qty > free) {
      if (!data.backorder) {
        throw new Error(`Stock insuficiente para ${item.name}: disponible ${free}, pedido ${l.qty}.`);
      }
      shortages.push({ productId: l.productId, qty: l.qty - free });
    }
  }
  if (overdueReceivable(s, buyer.id, todayGuayaquil()) > 0.009) {
    throw new Error('El cliente tiene cartera vencida. Regulariza el saldo antes de pedir.');
  }
  const limit = buyer.creditLimit ?? 0;
  const nextCredit = creditUsed(s, buyer.id) + outstandingReceivable(s, buyer.id) + orderValue(s, draft);
  if (nextCredit > limit + 0.009) {
    const left = Math.max(0, limit - creditUsed(s, buyer.id) - outstandingReceivable(s, buyer.id));
    throw new Error(
      `El pedido supera el cupo de crédito. Disponible $${left.toFixed(2)}, pedido $${orderValue(s, draft).toFixed(2)}.`,
    );
  }
  const numericIds = s.orders
    .map((o) => Number(String(o.id).replace(/^PED-H?/, '')))
    .filter((n) => Number.isFinite(n));
  const n = Math.max(1048, ...numericIds, 0) + 1;
  const o: Order = {
    id: `PED-${n}`,
    clientId: data.clientId,
    lines: priced,
    kits: kits.length ? kits : undefined,
    priority: data.priority ?? 'Normal',
    status: shortages.length ? 'Esperando stock' : 'Por preparar',
    date: new Date().toISOString().slice(0, 10),
    notes: data.notes?.trim() || undefined,
    ...(shortages.length ? { shortages } : {}),
    createdBy: actorName(s),
    ...(data.channel ? { channel: data.channel } : {}),
  };
  if (data.channel && !['portal', 'ejecutivo', 'reposicion'].includes(data.channel)) {
    throw new Error('El canal debe ser portal, ejecutivo o reposición.');
  }
  s.orders.unshift(o);
  return o;
}

export type PickPlanLine = Lot & { qty: number };

/** Fecha de entrada: receivedAt → recepción del lote → caducidad como último recurso. */
export function lotEntryDate(s: AppState, lot: Lot): string {
  if (lot.receivedAt && /^\d{4}-\d{2}-\d{2}/.test(lot.receivedAt)) {
    return lot.receivedAt.slice(0, 10);
  }
  const linked = receiptOfLot(s, lot);
  if (linked?.date && /^\d{4}-\d{2}-\d{2}/.test(linked.date)) return linked.date.slice(0, 10);
  const receipt = s.receipts.find(
    (r) => r.productId === lot.productId && r.batch === lot.batch && /^\d{4}-\d{2}-\d{2}/.test(r.date),
  );
  if (receipt) return receipt.date.slice(0, 10);
  if (lot.expiry && /^\d{4}-\d{2}-\d{2}/.test(lot.expiry)) return lot.expiry.slice(0, 10);
  return '9999-12-31';
}

/** Sin fecha va al final: primero se agota lo que sí caduca. */
function expiryKey(expiry: string | undefined) {
  return /^\d{4}-\d{2}-\d{2}/.test(expiry ?? '') ? expiry!.slice(0, 10) : '9999-12-31';
}

/** FEFO: vence antes primero. Empate por fecha de ingreso y luego por ubicación. */
export function fefoCompare(a: Lot, b: Lot) {
  const byExpiry = expiryKey(a.expiry).localeCompare(expiryKey(b.expiry));
  if (byExpiry) return byExpiry;
  return (a.receivedAt ?? '').localeCompare(b.receivedAt ?? '') || a.loc.localeCompare(b.loc);
}

function compareLotsFefo(s: AppState, a: Lot, b: Lot) {
  const byExpiry = expiryKey(a.expiry).localeCompare(expiryKey(b.expiry));
  if (byExpiry) return byExpiry;
  const byEntry = lotEntryDate(s, a).localeCompare(lotEntryDate(s, b));
  if (byEntry) return byEntry;
  return a.loc.localeCompare(b.loc);
}

export function pickPlan(s: AppState, order: Order): PickPlanLine[] {
  const plan: PickPlanLine[] = [];
  const today = todayGuayaquil();
  for (const line of expandedDemand(s, order)) {
    let left = line.qty;
    const lots = lotsForActiveWarehouse(s)
      .filter((l) => l.productId === line.productId && isLotSellable(s, l, today))
      .sort((a, b) => compareLotsFefo(s, a, b));
    for (const l of lots) {
      if (!left) break;
      const qty = Math.min(l.qty, left);
      plan.push({ ...l, qty, receivedAt: lotEntryDate(s, l) });
      left -= qty;
    }
    if (left) {
      throw new Error(`Faltan ${left} unidades de ${product(s, line.productId)?.name}.`);
    }
  }
  return plan;
}

export function prepare(s: AppState, orderId: string) {
  const o = s.orders.find((x) => x.id === orderId);
  if (!o || o.status !== 'Por preparar') {
    throw new Error('Este pedido ya no está pendiente de preparación.');
  }
  const plan = pickPlan(s, o);
  for (const p of plan) {
    const lot = s.lots.find((l) => l.id === p.id);
    if (lot) lot.qty -= p.qty;
    addEvent(s, 'Preparación', p.productId, p.qty, p.loc, 'Zona de despacho', o.id, p.batch);
  }
  s.lots = s.lots.filter((l) => l.qty > 0);
  o.picks = plan.map((p) => ({
    productId: p.productId,
    qty: p.qty,
    batch: p.batch,
    loc: p.loc,
    expiry: p.expiry,
    ...(p.purchaseId ? { purchaseId: p.purchaseId } : {}),
  }));
  o.status = 'Preparado';
  return o;
}

export function assertFitsVehicle(
  s: AppState,
  plate: string,
  orders: Order[],
  limits?: { maxKg?: number; maxM3?: number },
) {
  const registered = vehicleByPlate(s, plate);
  if (!registered) throw new Error('El vehículo no está registrado en la flota.');
  const maxKg = Number.isFinite(limits?.maxKg) ? Number(limits!.maxKg) : registered.maxKg;
  const maxM3 = Number.isFinite(limits?.maxM3) ? Number(limits!.maxM3) : registered.maxM3;
  const totalKg = orders.reduce((n, o) => n + orderWeight(s, o), 0);
  const totalM3 =
    orders.reduce(
      (n, o) =>
        n + expandedDemand(s, o).reduce((v, l) => v + l.qty * (product(s, l.productId)?.volume ?? 0), 0),
      0,
    ) / 1000;
  if (totalKg > maxKg + 0.01) {
    throw new Error(`La carga supera la capacidad de ${Math.round(maxKg)} kg del vehículo.`);
  }
  if (totalM3 > maxM3 + 0.01) {
    throw new Error(`La carga supera la capacidad de ${maxM3} m³ del vehículo.`);
  }
}

export function dispatch(
  s: AppState,
  ids: string[],
  vehicle: string,
  limits?: { maxKg?: number; maxM3?: number },
) {
  const orders = s.orders.filter((o) => ids.includes(o.id));
  if (!orders.length || orders.some((o) => o.status !== 'Preparado')) {
    throw new Error('Selecciona pedidos preparados.');
  }
  const missingPick = orders.find((o) => !o.picks?.length);
  if (missingPick) {
    throw new Error(`Prepara ${missingPick.id} antes de despachar: falta el lote de salida.`);
  }
  const current = s.orders.filter(
    (o) => o.vehicle?.toUpperCase() === vehicle.trim().toUpperCase() && ['En ruta', 'Incidencia'].includes(o.status),
  );
  const all = [...current, ...orders];
  assertFitsVehicle(s, vehicle, all, limits);
  for (const o of orders) {
    o.vehicle = vehicle.trim().toUpperCase();
    o.stagedPlate = undefined;
    issueGuide(s, { orderId: o.id });
    if (!o.deliveryCode || !o.deliveryKey) {
      o.deliveryCode = String(Math.floor(100000 + Math.random() * 900000));
      o.deliveryKey = Math.random().toString(36).slice(2, 12);
    }
    o.status = 'En ruta';
    const lines: OrderPick[] = o.picks ?? o.lines;
    for (const line of lines) {
      addEvent(
        s,
        'Despacho',
        line.productId,
        line.qty,
        'Zona de despacho',
        client(s, o.clientId)?.name ?? o.clientId,
        o.id,
        line.batch ?? '',
      );
    }
  }
}

export function deleteProduct(s: AppState, id: string) {
  const item = product(s, id);
  if (!item) throw new Error('Producto no encontrado.');
  if (s.lots.some((lot) => lot.productId === id && lot.qty > 0)) {
    throw new Error('El producto tiene stock. Vacía las ubicaciones antes de eliminarlo.');
  }
  if (s.orders.some((order) => order.lines.some((line) => line.productId === id) || order.kits?.some((kit) => kit.bundleId === id))) {
    throw new Error('El producto está en pedidos y se conserva para la trazabilidad.');
  }
  if (s.purchases.some((po) => po.status !== 'Cancelada' && po.status !== 'Recibida' && (po.productId === id || po.lines?.some((line) => line.productId === id)))) {
    throw new Error('El producto tiene una orden de compra abierta.');
  }
  if (s.bundles?.some((bundle) => bundle.lines.some((line) => line.productId === id))) {
    throw new Error('El producto forma parte de un paquete.');
  }
  if (s.products.some((parent) => parent.components?.some((component) => component.productId === id))) {
    throw new Error('El producto es insumo de otro producto.');
  }
  s.products = s.products.filter((entry) => entry.id !== id);
}

export function upsertProduct(s: AppState, p: Product, originalId?: string) {
  const normalized = normalizeProductBom({
    ...p,
    components: p.components ?? [],
    kind: p.kind === 'raw' ? 'raw' : p.kind ?? 'finished',
  });
  normalized.attributes = (p.attributes ?? [])
    .map((attribute) => ({ name: String(attribute?.name ?? '').trim(), value: String(attribute?.value ?? '').trim() }))
    .filter((attribute) => attribute.name && attribute.value)
    .slice(0, 24);
  if (!normalized.attributes.length) delete normalized.attributes;
  normalized.presentations = [...new Set((p.presentations ?? []).map((item) => item.trim()).filter(Boolean))].slice(0, 12);
  if (!normalized.presentations.length) delete normalized.presentations;
  validateComponents(s, normalized.id, normalized.components);
  if (originalId) {
    const existing = product(s, originalId);
    if (!existing) throw new Error('Producto no encontrado.');
    Object.assign(existing, normalized);
    return existing;
  }
  if (s.products.some((x) => x.id === p.id)) {
    throw new Error('Ya existe un producto con este código.');
  }
  s.products.push(normalized);
  return normalized;
}

export function confirmDelivery(
  s: AppState,
  orderId: string,
  person: string,
  notes?: string,
  code?: string,
) {
  const o = s.orders.find((x) => x.id === orderId);
  if (!o || !['En ruta', 'Incidencia'].includes(o.status)) {
    throw new Error('El pedido no está en ruta.');
  }
  if (!person.trim()) throw new Error('Escribe el nombre de quien recibe.');
  if (o.deliveryCode && o.deliveryCode !== String(code ?? '').trim()) {
    throw new Error('El código de entrega no coincide.');
  }
  o.status = 'Entregado';
  o.deliveredTo = person.trim();
  o.deliveryNotes = notes;
  o.deliveredAt = new Date().toISOString();
  const lines: OrderPick[] = o.picks ?? o.lines;
  for (const line of lines) {
    addEvent(
      s,
      'Entrega',
      line.productId,
      line.qty,
      'Vehículo ' + (o.vehicle ?? ''),
      client(s, o.clientId)?.name ?? o.clientId,
      o.id,
      line.batch ?? '',
    );
  }
  return o;
}

export function registerIncident(
  s: AppState,
  orderId: string,
  reason: string,
  notes?: string,
) {
  const o = s.orders.find((x) => x.id === orderId);
  if (!o || !['En ruta', 'Incidencia'].includes(o.status)) {
    throw new Error('El pedido no está en ruta.');
  }
  o.status = 'Incidencia';
  o.incident = reason + (notes ? ' · ' + notes : '');
  const lines: OrderPick[] = o.picks ?? o.lines;
  for (const line of lines) {
    addEvent(s, 'Novedad', line.productId, line.qty, o.id, reason, o.id, line.batch ?? '');
  }
  return o;
}
