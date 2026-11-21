import type { AppState, Client, Order, OrderPick, PurchaseLine } from './types.js';
import {
  addEvent,
  assertFitsVehicle,
  available,
  expandedDemand,
  product,
  receive,
  uid,
} from './inventory.service.js';
import { cellFits } from './capacity.js';
import { packsOf, stockQtyFromPack, unitsPerPack } from './packs.js';
import { pendingStockUnits, refreshPurchase } from './purchase-lines.js';
import { vehicleByPlate } from './fleet.service.js';
import { suggest } from './placement.service.js';
import { activeWarehouseId, lotsForActiveWarehouse } from './warehouse-admin.service.js';
import { getWarehouseGeometry } from './warehouse-layout.js';

const OPEN_ORDER = ['Esperando stock', 'Por preparar', 'Preparado', 'En ruta', 'Incidencia'];

/* ─── Pedidos ─────────────────────────────────────────────── */

function restockLocation(s: AppState, productId: string, qty: number, preferred?: string) {
  const geo = getWarehouseGeometry(s);
  const fits = (locId: string) => {
    const loc = geo.locations.find((l) => l.id === locId);
    if (!loc || !cellFits(s, loc, productId, qty)) return false;
    return !lotsForActiveWarehouse(s).some((l) => l.loc === locId && l.productId !== productId);
  };
  if (preferred && fits(preferred)) return preferred;
  return suggest(s, productId, qty)[0]?.id;
}

/**
 * Por preparar: libera la reserva. Preparado: devuelve lo pickeado a bodega
 * (misma ubicación si cabe; si no, la mejor sugerida).
 */
export function cancelOrder(s: AppState, orderId: string, reason: string) {
  const o = s.orders.find((x) => x.id === orderId);
  if (!o) throw new Error('Pedido no encontrado.');
  if (!['Esperando stock', 'Por preparar', 'Preparado'].includes(o.status)) {
    throw new Error('Solo se pueden cancelar pedidos esperando stock, por preparar o preparados.');
  }
  if (s.invoices?.some((invoice) => invoice.orderId === orderId && invoice.status === 'Emitida')) {
    throw new Error('El pedido tiene factura emitida. Emite una nota de crédito.');
  }
  const why = reason?.trim();
  if (!why) throw new Error('Indica el motivo de la cancelación.');

  if (o.status === 'Preparado') {
    const picks: OrderPick[] = o.picks?.length ? o.picks : o.lines;
    const restocked: Array<{ productId: string; qty: number; loc: string; batch: string }> = [];
    for (const pick of picks) {
      const loc = restockLocation(s, pick.productId, pick.qty, pick.loc);
      if (!loc) {
        throw new Error(
          `No hay ubicación disponible para devolver ${pick.qty} u. de ${product(s, pick.productId)?.name ?? pick.productId}.`,
        );
      }
      const batch = pick.batch || `DEV-${o.id}`;
      const sameBatch = s.lots.find((l) => l.productId === pick.productId && l.batch === batch);
      const expiry =
        pick.expiry ||
        sameBatch?.expiry ||
        s.lots
          .filter((l) => l.productId === pick.productId)
          .map((l) => l.expiry)
          .sort()
          .at(-1) ||
        new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10);
      s.lots.push({
        id: uid('lot'),
        productId: pick.productId,
        qty: pick.qty,
        loc,
        batch,
        expiry,
        warehouseId: activeWarehouseId(s),
        purchaseId: pick.purchaseId ?? sameBatch?.purchaseId,
        receiptId: sameBatch?.receiptId,
        receivedAt: sameBatch?.receivedAt ?? new Date().toISOString(),
      });
      restocked.push({ productId: pick.productId, qty: pick.qty, loc, batch });
    }
    for (const r of restocked) {
      addEvent(s, 'Devolución', r.productId, r.qty, 'Zona de despacho', r.loc, o.id, r.batch);
    }
  }

  if (o.purchaseIds?.length) {
    for (const po of s.purchases) {
      if (po.orderIds?.includes(o.id)) po.orderIds = po.orderIds.filter((id) => id !== o.id);
    }
  }
  o.status = 'Cancelado';
  o.cancelReason = why;
  o.cancelledAt = new Date().toISOString();
  o.stagedPlate = undefined;
  return o;
}

/** Carga pedidos preparados en un camión. Queda guardado hasta el despacho. */
export function stageOrders(s: AppState, ids: string[], plate: string) {
  const unique = [...new Set(ids)];
  if (!unique.length) throw new Error('Selecciona pedidos preparados.');
  const vehicle = vehicleByPlate(s, plate);
  if (!vehicle) throw new Error('El vehículo no está registrado en la flota.');
  if (!vehicle.active) throw new Error(`El vehículo ${vehicle.plate} está inactivo.`);
  const picked = unique.map((id) => {
    const o = s.orders.find((x) => x.id === id);
    if (!o || o.status !== 'Preparado') throw new Error('Solo se cargan pedidos preparados.');
    return o;
  });
  const already = s.orders.filter(
    (o) => o.status === 'Preparado' && o.stagedPlate === vehicle.plate && !unique.includes(o.id),
  );
  const enRoute = s.orders.filter(
    (o) => o.vehicle === vehicle.plate && ['En ruta', 'Incidencia'].includes(o.status),
  );
  assertFitsVehicle(s, vehicle.plate, [...enRoute, ...already, ...picked]);
  for (const o of picked) o.stagedPlate = vehicle.plate;
}

export function unstageOrders(s: AppState, ids: string[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) throw new Error('Selecciona pedidos para retirar del camión.');
  let cleared = 0;
  for (const id of unique) {
    const o = s.orders.find((x) => x.id === id);
    if (!o || o.status !== 'Preparado' || !o.stagedPlate) continue;
    o.stagedPlate = undefined;
    cleared += 1;
  }
  if (!cleared) throw new Error('Esos pedidos no están cargados en un camión.');
}

/* ─── Clientes ────────────────────────────────────────────── */

const CLIENT_FIELDS = ['name', 'contact', 'address', 'email', 'type'] as const;

function cleanClient(input: Partial<Client>) {
  const out: Omit<Client, 'id'> = {
    name: '',
    contact: '',
    address: '',
    email: '',
    type: '',
  };
  for (const f of CLIENT_FIELDS) {
    const v = typeof input[f] === 'string' ? input[f]!.trim() : '';
    if (!v) throw new Error('Completa nombre, contacto, dirección, correo y tipo del cliente.');
    out[f] = v;
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(out.email)) throw new Error('El correo no es válido.');
  const taxId = String(input.taxId ?? '').replace(/\D/g, '');
  if (!/^\d{13}$/.test(taxId)) throw new Error('El RUC debe tener 13 dígitos.');
  out.taxId = taxId;
  const city = input.city?.trim() ?? '';
  if (city) out.city = city;
  const sector = input.sector?.trim() ?? '';
  if (sector) out.sector = sector;
  const phone = input.phone?.trim() ?? '';
  if (phone) out.phone = phone;
  const cadence = Number(input.reorderEveryDays);
  if (Number.isInteger(cadence) && cadence > 0) out.reorderEveryDays = cadence;
  if (Number.isFinite(input.lat) && Number.isFinite(input.lng)) {
    out.lat = Number(input.lat);
    out.lng = Number(input.lng);
  }
  return out;
}

function assertUniqueClientTax(s: AppState, taxId: string, exceptId?: string) {
  if (s.clients.some((client) => client.id !== exceptId && client.taxId === taxId)) {
    throw new Error('Ya existe un cliente con ese RUC.');
  }
}

export function createClient(s: AppState, input: Partial<Client>) {
  const data = cleanClient(input);
  assertUniqueClientTax(s, data.taxId!);
  if (s.clients.some((c) => c.name.toLowerCase() === data.name.toLowerCase())) {
    throw new Error('Ya existe un cliente con ese nombre.');
  }
  const n = Math.max(0, ...s.clients.map((c) => Number(c.id.replace(/\D/g, '')) || 0)) + 1;
  const c: Client = { id: `CL${String(n).padStart(3, '0')}`, ...data };
  s.clients.push(c);
  return c;
}

export function updateClient(s: AppState, id: string, input: Partial<Client>) {
  const c = s.clients.find((x) => x.id === id);
  if (!c) throw new Error('Cliente no encontrado.');
  const data = cleanClient({ ...c, ...input });
  assertUniqueClientTax(s, data.taxId!, id);
  if (s.clients.some((x) => x.id !== id && x.name.toLowerCase() === data.name.toLowerCase())) {
    throw new Error('Ya existe un cliente con ese nombre.');
  }
  delete c.city;
  delete c.sector;
  delete c.phone;
  delete c.reorderEveryDays;
  delete c.lat;
  delete c.lng;
  Object.assign(c, data);
  return c;
}

export function deleteClient(s: AppState, id: string) {
  const c = s.clients.find((x) => x.id === id);
  if (!c) throw new Error('Cliente no encontrado.');
  if (s.orders.some((o) => o.clientId === id && OPEN_ORDER.includes(o.status))) {
    throw new Error('El cliente tiene pedidos activos. Complétalos o cancélalos antes de eliminarlo.');
  }
  if (s.orders.some((o) => o.clientId === id)) {
    throw new Error('El cliente tiene historial de pedidos; se conserva para la trazabilidad.');
  }
  s.clients = s.clients.filter((x) => x.id !== id);
}

/* ─── Órdenes de compra ───────────────────────────────────── */

export function createPurchase(
  s: AppState,
  body: {
    productId?: string;
    qty?: number | string;
    date?: string;
    expectedDate?: string;
    notes?: string;
    supplierId?: string;
    orderIds?: string[];
    lines?: Array<{
      productId: string;
      qty: number | string;
      packCode?: string;
      unitPrice?: number | string;
      batch?: string;
      expiry?: string;
    }>;
  },
) {
  const rawLines = body.lines?.length
    ? body.lines
    : body.productId
      ? [{ productId: body.productId, qty: body.qty ?? 0, packCode: 'unidad', unitPrice: 0 }]
      : [];
  if (!rawLines.length) throw new Error('La orden necesita al menos un producto.');
  if (body.supplierId && !s.suppliers?.some((supplier) => supplier.id === body.supplierId)) {
    throw new Error('Proveedor no encontrado.');
  }
  const lines: PurchaseLine[] = rawLines.map((line) => {
    const item = product(s, line.productId);
    if (!item) throw new Error('Selecciona un producto válido.');
    const packCode = line.packCode || 'unidad';
    const packQty = Number(line.qty);
    if (!Number.isInteger(packQty) || packQty <= 0) {
      throw new Error('La cantidad debe ser un entero mayor que cero.');
    }
    const perPack = unitsPerPack(item, packCode);
    stockQtyFromPack(item, packQty, packCode);
    const unitPrice = Number(line.unitPrice ?? item.price);
    return {
      productId: line.productId,
      qty: packQty,
      packCode,
      unitsPerPack: perPack,
      unitPrice: Number.isFinite(unitPrice) && unitPrice >= 0 ? unitPrice : 0,
      receivedUnits: 0,
      batch: line.batch?.trim() || undefined,
      expiry: line.expiry?.trim() || undefined,
    };
  });
  const n = Math.max(0, ...s.purchases.map((p) => Number(p.id.replace(/\D/g, '')) || 0)) + 1;
  const purchase = refreshPurchase({
    id: `OC-${String(n).padStart(4, '0')}`,
    supplierId: body.supplierId || undefined,
    productId: lines[0].productId,
    qty: 0,
    date: body.date || new Date().toISOString().slice(0, 10),
    expectedDate: body.expectedDate || undefined,
    notes: body.notes?.trim() || undefined,
    received: 0,
    status: 'Abierta',
    lines,
    ...(body.orderIds?.length ? { orderIds: [...new Set(body.orderIds)] } : {}),
  });
  s.purchases.unshift(purchase);
  return purchase;
}

export function cancelPurchase(s: AppState, id: string) {
  const p = s.purchases.find((x) => x.id === id);
  if (!p) throw new Error('Orden de compra no encontrada.');
  if (p.status === 'Recibida') throw new Error('La orden ya fue recibida por completo.');
  if (p.status === 'Cancelada') throw new Error('La orden ya está cancelada.');
  if (p.status === 'Cerrada') throw new Error('La orden ya está cerrada.');
  if ((p.received ?? 0) > 0) {
    throw new Error('La orden ya tiene mercadería recibida. Ciérrala con faltante en lugar de cancelarla.');
  }
  p.status = 'Cancelada';
  return p;
}

/** Cierra una OC parcial: lo recibido queda, el faltante ya no se espera. */
export function closePurchase(s: AppState, id: string, reason: string) {
  const p = s.purchases.find((x) => x.id === id);
  if (!p) throw new Error('Orden de compra no encontrada.');
  if (p.status !== 'Parcial') throw new Error('Solo se cierran con faltante las órdenes parciales.');
  const why = reason?.trim();
  if (!why) throw new Error('Indica por qué se cierra con faltante.');
  p.status = 'Cerrada';
  p.closeReason = why;
  return p;
}

/** Recibe varias líneas de una OC en un solo paso. Todo o nada. */
export function receivePurchase(
  s: AppState,
  id: string,
  body: {
    lines: Array<{
      productId: string;
      qty: number | string;
      loc: string;
      batch: string;
      expiry: string;
      inspect?: boolean;
    }>;
  },
) {
  const po = s.purchases.find((x) => x.id === id);
  if (!po) throw new Error('Orden de compra no encontrada.');
  if (!isOpenPurchase(po)) throw new Error('La orden no está abierta.');
  const lines = (body.lines ?? []).filter((line) => Number(line.qty) > 0);
  if (!lines.length) throw new Error('Indica al menos una línea con cantidad recibida.');
  const supplier = s.suppliers?.find((x) => x.id === po.supplierId)?.name ?? '';
  const ids: string[] = [];
  for (const line of lines) {
    const name = product(s, line.productId)?.name ?? line.productId;
    try {
      ids.push(
        receive(s, {
          productId: line.productId,
          qty: line.qty,
          loc: line.loc,
          batch: line.batch,
          expiry: line.expiry,
          supplier,
          purchaseId: po.id,
          inspect: line.inspect,
        }),
      );
    } catch (e) {
      throw new Error(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return ids;
}

/* ─── Pedidos con faltante ────────────────────────────────── */

/** Crea una OC por proveedor para el faltante del pedido y las enlaza. */
export function createBackorderPurchases(s: AppState, order: Order) {
  const shortages = order.shortages ?? [];
  if (!shortages.length) return [];
  const groups = new Map<string, Array<{ productId: string; qty: number; packCode: string; unitPrice: number }>>();
  for (const short of shortages) {
    const item = product(s, short.productId);
    if (!item) continue;
    const supplierId =
      item.supplierId ??
      s.suppliers?.find((x) => x.name.toLowerCase() === (item.supplier ?? '').toLowerCase())?.id ??
      '';
    const packs = packsOf(item);
    const pack = [...packs].sort((a, b) => a.units - b.units).find((x) => x.units >= 1) ?? packs[0];
    const perPack = Math.max(1, pack.units);
    const packQty = Math.max(1, Math.ceil(short.qty / perPack));
    const unitPrice = Math.round((item.avgCost ?? 0) * perPack * 100) / 100;
    const list = groups.get(supplierId) ?? [];
    list.push({ productId: item.id, qty: packQty, packCode: pack.code, unitPrice });
    groups.set(supplierId, list);
  }
  const created = [];
  for (const [supplierId, lines] of groups) {
    const supplier = s.suppliers?.find((x) => x.id === supplierId);
    const expected = new Date();
    expected.setDate(expected.getDate() + (supplier?.leadTimeDays || 7));
    const po = createPurchase(s, {
      supplierId: supplierId || undefined,
      expectedDate: expected.toISOString().slice(0, 10),
      notes: `Faltante del pedido ${order.id}.`,
      orderIds: [order.id],
      lines,
    });
    created.push(po);
  }
  order.purchaseIds = [...new Set([...(order.purchaseIds ?? []), ...created.map((po) => po.id)])];
  return created;
}

/**
 * Pasa a "Por preparar" los pedidos que esperaban stock y ya se pueden cubrir,
 * del más antiguo al más nuevo.
 */
export function promoteWaitingOrders(s: AppState) {
  const waiting = s.orders
    .filter((o) => o.status === 'Esperando stock')
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const promoted: string[] = [];
  for (const o of waiting) {
    const ok = expandedDemand(s, o).every((line) => available(s, line.productId) >= line.qty);
    if (!ok) continue;
    o.status = 'Por preparar';
    delete o.shortages;
    promoted.push(o.id);
    addEvent(s, 'Stock completo', o.lines[0]?.productId ?? '', 0, 'Esperando stock', 'Por preparar', o.id);
  }
  return promoted;
}

/** Faltante actual de un pedido que espera stock. */
export function currentShortages(s: AppState, o: Order) {
  return expandedDemand(s, o)
    .map((line) => ({ productId: line.productId, qty: line.qty - Math.max(0, available(s, line.productId)) }))
    .filter((line) => line.qty > 0);
}

export { pendingStockUnits };

export const isOpenPurchase = (p: { status?: string }) =>
  !p.status || p.status === 'Abierta' || p.status === 'Parcial';
