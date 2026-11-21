import type {
  AppState,
  CustomerQuote,
  Order,
  PlanAction,
  ProductAttribute,
  SalesChannel,
  SupplierOffering,
  Vehicle,
} from './types.js';
import { createOrder, expandedDemand, orderWeight, product } from './inventory.service.js';
import { cancelPurchase, createPurchase } from './commerce.service.js';
import { shipTransfer, suggestReplenishment } from './commercial.service.js';
import { vehicleByPlate } from './fleet.service.js';
import { isSellableLoc } from './ledger.js';
import { activeWarehouseId, DEFAULT_WAREHOUSE_ID } from './warehouse-admin.service.js';

export const MIN_FILL = 0.8;
export const SALES_CHANNELS: SalesChannel[] = ['portal', 'ejecutivo', 'reposicion'];

const CITY_POINT: Record<string, { lat: number; lng: number }> = {
  quito: { lat: -0.1807, lng: -78.4678 },
  guayaquil: { lat: -2.1894, lng: -79.8891 },
  cuenca: { lat: -2.9001, lng: -79.0059 },
  'santo domingo': { lat: -0.2542, lng: -79.1719 },
  ambato: { lat: -1.2491, lng: -78.6168 },
};

const PRESENTATIONS = ['Unidad', 'Caja', 'Paquete', 'Galón', 'Litro', 'Botella', 'Bidón', 'Saco', 'Kilo', 'Rollo'];
const HAZARD_WORDS: Array<[RegExp, string]> = [
  [/inflamable/i, 'Inflamable'],
  [/cloro|clorad/i, 'Clorado'],
  [/ácid|acid/i, 'Ácido'],
  [/corrosiv/i, 'Corrosivo'],
  [/aerosol/i, 'Aerosol'],
];

export function ensureOutbound(s: AppState) {
  if (!s.quotes) s.quotes = [];
  if (!s.parcels) s.parcels = [];
  if (!s.offerings) s.offerings = [];
  if (!s.planActions) s.planActions = [];
  return s;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function nextNumber(ids: string[], prefix: string, width: number) {
  const n = Math.max(0, ...ids.map((id) => Number(id.slice(prefix.length)) || 0)) + 1;
  return `${prefix}${String(n).padStart(width, '0')}`;
}

function channelOf(value: unknown): SalesChannel {
  const channel = typeof value === 'string' ? value : 'ejecutivo';
  if (!SALES_CHANNELS.includes(channel as SalesChannel)) {
    throw new Error('El canal debe ser portal, ejecutivo o reposición.');
  }
  return channel as SalesChannel;
}

function pointOf(client: { lat?: number; lng?: number; city?: string }) {
  if (Number.isFinite(client.lat) && Number.isFinite(client.lng)) return { lat: client.lat as number, lng: client.lng as number };
  const city = (client.city ?? 'quito').trim().toLowerCase();
  return CITY_POINT[city] ?? CITY_POINT.quito;
}

function kmBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h))) * 1.35;
}

export function quoteView(quote: CustomerQuote, day = today()) {
  return quote.status === 'Abierta' && quote.validUntil < day ? 'Vencida' : quote.status;
}

export function createQuote(
  s: AppState,
  body: {
    clientId?: string;
    validUntil?: string;
    channel?: string;
    note?: string;
    lines?: Array<{ productId?: string; qty?: number | string; unitPrice?: number | string }>;
  },
) {
  ensureOutbound(s);
  const buyer = s.clients.find((client) => client.id === body.clientId);
  if (!buyer) throw new Error('Selecciona un cliente.');
  const validUntil = String(body.validUntil ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validUntil) || validUntil < today()) {
    throw new Error('La cotización necesita una vigencia de hoy en adelante.');
  }
  const lines = (body.lines ?? []).map((line) => {
    const item = product(s, String(line.productId ?? ''));
    const qty = Number(line.qty);
    const unitPrice = Number(line.unitPrice);
    if (!item) throw new Error('Selecciona un producto de la cotización.');
    if (!Number.isInteger(qty) || qty <= 0) throw new Error('La cantidad de la cotización debe ser un entero mayor que cero.');
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error('El precio de la cotización no puede ser negativo.');
    return { productId: item.id, qty, unitPrice: Math.round(unitPrice * 100) / 100 };
  });
  if (!lines.length) throw new Error('La cotización necesita al menos un producto.');
  const quote: CustomerQuote = {
    id: nextNumber(s.quotes!.map((item) => item.id), 'COT-', 4),
    number: '',
    clientId: buyer.id,
    date: today(),
    validUntil,
    status: 'Abierta',
    channel: channelOf(body.channel),
    lines,
    note: body.note?.trim() || undefined,
  };
  quote.number = quote.id;
  s.quotes!.unshift(quote);
  return quote;
}

export function loseQuote(s: AppState, id: string) {
  ensureOutbound(s);
  const quote = s.quotes!.find((item) => item.id === id);
  if (!quote) throw new Error('Cotización no encontrada.');
  if (quote.status !== 'Abierta') throw new Error('Solo se pierde una cotización abierta.');
  quote.status = 'Perdida';
  return quote;
}

export function winQuote(s: AppState, id: string) {
  ensureOutbound(s);
  const quote = s.quotes!.find((item) => item.id === id);
  if (!quote) throw new Error('Cotización no encontrada.');
  if (quote.status !== 'Abierta') throw new Error('Solo se gana una cotización abierta.');
  if (quoteView(quote) === 'Vencida') throw new Error('La cotización está vencida. Extiende la vigencia antes de ganarla.');
  const order = createOrder(s, {
    clientId: quote.clientId,
    lines: quote.lines.map((line) => ({ productId: line.productId, qty: line.qty })),
    channel: quote.channel,
    notes: `Desde ${quote.number}`,
  });
  quote.status = 'Ganada';
  quote.orderId = order.id;
  order.quoteId = quote.id;
  return { quote, order };
}

export function packOrder(s: AppState, orderId: string, weightKg: number, volumeM3: number) {
  ensureOutbound(s);
  const order = s.orders.find((item) => item.id === orderId);
  if (!order || order.status !== 'Preparado') throw new Error('Solo se empaca un pedido preparado.');
  if (!Number.isFinite(weightKg) || weightKg <= 0) throw new Error('El peso del bulto debe ser mayor que cero.');
  if (!Number.isFinite(volumeM3) || volumeM3 <= 0) throw new Error('El volumen del bulto debe ser mayor que cero.');
  const parcel = {
    id: nextNumber(s.parcels!.map((item) => item.id), 'BUL-', 4),
    orderId,
    weightKg: Math.round(weightKg * 100) / 100,
    volumeM3: Math.round(volumeM3 * 1000) / 1000,
    packedAt: new Date().toISOString(),
  };
  s.parcels!.push(parcel);
  return parcel;
}

export function orderLoad(s: AppState, order: Order) {
  const parcels = (s.parcels ?? []).filter((parcel) => parcel.orderId === order.id);
  if (parcels.length) {
    return {
      kg: parcels.reduce((sum, parcel) => sum + parcel.weightKg, 0),
      m3: parcels.reduce((sum, parcel) => sum + parcel.volumeM3, 0),
      packed: true,
    };
  }
  const m3 =
    expandedDemand(s, order).reduce((sum, line) => sum + line.qty * (product(s, line.productId)?.volume ?? 0), 0) / 1000;
  return { kg: orderWeight(s, order), m3, packed: false };
}

export function loadPreview(s: AppState, plate: string, orderIds: string[]) {
  const vehicle = vehicleByPlate(s, plate);
  if (!vehicle) throw new Error('El vehículo no está registrado en la flota.');
  const orders = orderIds.map((id) => s.orders.find((order) => order.id === id));
  if (orders.some((order) => !order)) throw new Error('Hay un pedido que no existe.');
  const chosen = orders as Order[];
  if (chosen.some((order) => !['Preparado', 'En ruta', 'Incidencia'].includes(order.status))) {
    throw new Error('La carga solo admite pedidos preparados o que ya van en el camión.');
  }
  const loads = chosen.map((order) => ({ order, ...orderLoad(s, order) }));
  const kg = loads.reduce((sum, load) => sum + load.kg, 0);
  const m3 = loads.reduce((sum, load) => sum + load.m3, 0);
  const kgPct = vehicle.maxKg > 0 ? kg / vehicle.maxKg : 0;
  const m3Pct = vehicle.maxM3 > 0 ? m3 / vehicle.maxM3 : 0;
  const fill = Math.max(kgPct, m3Pct);
  const sequenced = [...chosen].sort((a, b) => (a.stopOrder ?? 0) - (b.stopOrder ?? 0));
  return {
    plate: vehicle.plate,
    kg: Math.round(kg * 10) / 10,
    m3: Math.round(m3 * 1000) / 1000,
    kgPct,
    m3Pct,
    fill,
    underMin: fill < MIN_FILL,
    over: kg > vehicle.maxKg + 0.01 || m3 > vehicle.maxM3 + 0.01,
    loadSequence: [...sequenced].reverse().map((order) => order.id),
    trip: tripCost(vehicle, Math.max(s.settings.businessRules?.shippingMinKm ?? 15, 8 + chosen.length * 4)),
  };
}

export function tripCost(vehicle: Vehicle, km: number) {
  const distance = Math.max(0, Number(km) || 0);
  const per = vehicle.kmPerUnit && vehicle.kmPerUnit > 0 ? vehicle.kmPerUnit : 0;
  const price = vehicle.fuelPrice ?? 0;
  const fuelUnits = per > 0 ? distance / per : 0;
  return {
    km: Math.round(distance * 10) / 10,
    allIn: Math.round(vehicle.costPerKm * distance * 100) / 100,
    fuel: Math.round(fuelUnits * price * 100) / 100,
    fuelUnits: Math.round(fuelUnits * 100) / 100,
    fuelType: vehicle.fuel ?? null,
  };
}

export function stampDeliveryCode(order: Order) {
  if (order.deliveryCode && order.deliveryKey) return order;
  order.deliveryCode = String(Math.floor(100000 + Math.random() * 900000));
  order.deliveryKey = Math.random().toString(36).slice(2, 12);
  return order;
}

export function customerDeliveryCode(s: AppState, orderId: string, key: string) {
  const order = s.orders.find((item) => item.id === orderId);
  if (!order || !order.deliveryKey || order.deliveryKey !== key) throw new Error('El enlace de entrega no es válido.');
  if (order.status === 'Entregado') return { status: order.status, code: null as string | null };
  if (!['En ruta', 'Incidencia'].includes(order.status)) throw new Error('El pedido todavía no está en ruta.');
  return { status: order.status, code: order.deliveryCode ?? null };
}

export function skipAndReoptimize(s: AppState, orderId: string) {
  const order = s.orders.find((item) => item.id === orderId);
  if (!order || !['En ruta', 'Incidencia'].includes(order.status)) throw new Error('El pedido no está en ruta.');
  if (!order.vehicle) throw new Error('El pedido no tiene vehículo.');
  order.skipped = true;
  order.status = 'Incidencia';
  order.incident = order.incident ? order.incident : 'Parada omitida';
  const plate = order.vehicle;
  const pending = s.orders.filter(
    (item) => item.vehicle === plate && ['En ruta', 'Incidencia'].includes(item.status) && !item.skipped,
  );
  const origin = CITY_POINT.quito;
  const remaining = [...pending];
  const ordered: Order[] = [];
  let cursor = origin;
  while (remaining.length) {
    remaining.sort((a, b) => {
      const clientA = s.clients.find((client) => client.id === a.clientId);
      const clientB = s.clients.find((client) => client.id === b.clientId);
      const da = kmBetween(cursor, pointOf(clientA ?? {}));
      const db = kmBetween(cursor, pointOf(clientB ?? {}));
      return da - db;
    });
    const next = remaining.shift()!;
    ordered.push(next);
    cursor = pointOf(s.clients.find((client) => client.id === next.clientId) ?? {});
  }
  ordered.forEach((item, index) => {
    item.stopOrder = index + 1;
  });
  s.orders.filter((item) => item.vehicle === plate && item.skipped).forEach((item) => {
    item.stopOrder = undefined;
  });
  return ordered.map((item) => item.id);
}

function onHand(s: AppState, warehouseId: string, productId: string) {
  return s.lots
    .filter(
      (lot) =>
        lot.productId === productId &&
        (lot.warehouseId ?? DEFAULT_WAREHOUSE_ID) === warehouseId &&
        !lot.onHold &&
        isSellableLoc(lot.loc),
    )
    .reduce((sum, lot) => sum + lot.qty, 0);
}

function deriveSuggestions(s: AppState): PlanAction[] {
  const actions: PlanAction[] = [];
  for (const group of suggestReplenishment(s)) {
    for (const line of group.lines) {
      if (actions.length >= 12) break;
      actions.push({
        id: `buy:${line.productId}`,
        kind: 'compra',
        status: 'sugerida',
        productId: line.productId,
        qty: line.packQty,
        supplierId: group.supplierId,
        packCode: line.packCode,
        unitPrice: line.unitPrice,
        reason: line.reason,
      });
    }
  }
  const fromId = activeWarehouseId(s);
  const destinations = s.warehouses.filter((warehouse) => warehouse.status === 'Operativa' && warehouse.id !== fromId);
  for (const item of s.products) {
    if (actions.filter((action) => action.kind === 'transferencia').length >= 6) break;
    if (item.min <= 0) continue;
    for (const destination of destinations) {
      const there = onHand(s, destination.id, item.id);
      if (there >= item.min) continue;
      const gap = item.min - there;
      const here = onHand(s, fromId, item.id);
      if (here - item.min < gap) continue;
      actions.push({
        id: `move:${item.id}:${destination.id}`,
        kind: 'transferencia',
        status: 'sugerida',
        productId: item.id,
        qty: gap,
        fromWarehouseId: fromId,
        toWarehouseId: destination.id,
        reason: 'Falta en la bodega de destino y sobra en la activa',
      });
      break;
    }
  }
  return actions;
}

export function planView(s: AppState) {
  ensureOutbound(s);
  const decided = s.planActions!.filter((action) => action.status !== 'sugerida');
  const suggestions = deriveSuggestions(s).filter((action) => !decided.some((item) => item.id === action.id));
  return {
    actions: [...suggestions, ...decided],
    forecast: clientForecast(s),
    diagnostics: stepDiagnostics(s),
  };
}

function remember(s: AppState, action: PlanAction) {
  const list = s.planActions!;
  const index = list.findIndex((item) => item.id === action.id);
  if (index >= 0) list[index] = action;
  else list.unshift(action);
  return action;
}

export function approvePlan(s: AppState, id: string) {
  ensureOutbound(s);
  const current = s.planActions!.find((action) => action.id === id);
  if (current && current.status !== 'sugerida') throw new Error('Esa acción ya se decidió.');
  const suggestion = deriveSuggestions(s).find((action) => action.id === id) ?? (current?.status === 'sugerida' ? current : undefined);
  if (!suggestion) throw new Error('La sugerencia ya no aplica.');
  if (suggestion.kind === 'compra') {
    const purchase = createPurchase(s, {
      supplierId: suggestion.supplierId,
      notes: `Plan de mañana · ${suggestion.reason}`,
      lines: [
        {
          productId: suggestion.productId,
          qty: suggestion.qty,
          packCode: suggestion.packCode,
          unitPrice: suggestion.unitPrice,
        },
      ],
    });
    suggestion.purchaseId = purchase.id;
  } else {
    const fromId = suggestion.fromWarehouseId ?? activeWarehouseId(s);
    const lot = s.lots.find(
      (item) =>
        item.productId === suggestion.productId &&
        item.qty >= suggestion.qty &&
        !item.onHold &&
        isSellableLoc(item.loc) &&
        (item.warehouseId ?? DEFAULT_WAREHOUSE_ID) === fromId,
    );
    if (!lot || !suggestion.toWarehouseId) throw new Error('No hay un lote vendible para trasladar esa cantidad.');
    const transfer = shipTransfer(s, { toWarehouseId: suggestion.toWarehouseId, lines: [{ lotId: lot.id, qty: suggestion.qty }] });
    suggestion.transferId = transfer.id;
  }
  suggestion.status = 'ejecutada';
  return remember(s, suggestion);
}

export function discardPlan(s: AppState, id: string, note?: string) {
  ensureOutbound(s);
  const suggestion = deriveSuggestions(s).find((action) => action.id === id);
  const current = s.planActions!.find((action) => action.id === id);
  const action = suggestion ?? current;
  if (!action || action.status !== 'sugerida') throw new Error('Solo se descarta una sugerencia abierta.');
  action.status = 'descartada';
  action.note = note?.trim() || undefined;
  return remember(s, action);
}

export function undoPlan(s: AppState, id: string) {
  ensureOutbound(s);
  const action = s.planActions!.find((item) => item.id === id);
  if (!action || action.status !== 'ejecutada') throw new Error('Solo se deshace una acción ejecutada.');
  if (action.kind === 'compra' && action.purchaseId) {
    cancelPurchase(s, action.purchaseId);
  } else if (action.transferId) {
    const transfer = s.transfers?.find((item) => item.id === action.transferId);
    if (!transfer || transfer.status !== 'En tránsito') {
      throw new Error('Solo se deshace un traslado que sigue en tránsito.');
    }
    for (const line of transfer.lines) {
      let lot = s.lots.find((item) => item.id === line.lotId);
      if (!lot) {
        const event = s.events.find((item) => item.ref === transfer.id && item.batch === line.batch && item.type === 'Traslado bodega');
        lot = {
          id: line.lotId,
          productId: line.productId,
          loc: event?.from || 'A1-D',
          qty: 0,
          batch: line.batch,
          expiry: line.expiry,
          warehouseId: transfer.fromWarehouseId,
          ...(line.purchaseId ? { purchaseId: line.purchaseId } : {}),
          ...(line.receiptId ? { receiptId: line.receiptId } : {}),
          ...(line.receivedAt ? { receivedAt: line.receivedAt } : {}),
        };
        s.lots.push(lot);
      }
      lot.qty += line.qty;
    }
    transfer.status = 'Cancelado';
  }
  action.status = 'deshecha';
  return action;
}

export function clientForecast(s: AppState) {
  const start = Date.now() - 28 * 24 * 60 * 60 * 1000;
  const week = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return s.clients.map((buyer) => {
    const orders = s.orders.filter((order) => order.clientId === buyer.id && order.status !== 'Cancelado' && Date.parse(order.date) >= start);
    const units = orders.reduce((sum, order) => sum + order.lines.reduce((lineSum, line) => lineSum + line.qty, 0), 0);
    const recent = orders
      .filter((order) => Date.parse(order.date) >= week)
      .reduce((sum, order) => sum + order.lines.reduce((lineSum, line) => lineSum + line.qty, 0), 0);
    const weekly = units / 4;
    const deviationPct = weekly > 0 ? Math.round(((recent - weekly) / weekly) * 100) : 0;
    return {
      clientId: buyer.id,
      name: buyer.name,
      weeklyUnits: Math.round(weekly * 10) / 10,
      orders: orders.length,
      confidence: Math.min(95, 35 + orders.length * 15),
      deviationPct,
      reorderEveryDays: buyer.reorderEveryDays ?? null,
    };
  });
}

export function stepDiagnostics(s: AppState) {
  const rows = [];
  for (const order of s.orders) {
    if (!order.deliveredAt) continue;
    const dispatched = s.events.find((event) => event.ref === order.id && event.type === 'Despacho');
    const start = Date.parse(dispatched?.at ?? `${order.date}T08:00:00`);
    const end = Date.parse(order.deliveredAt);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const hours = Math.round(((end - start) / 36e5) * 10) / 10;
    rows.push({
      orderId: order.id,
      clientId: order.clientId,
      hours,
      late: hours > 8,
      incident: order.incident ?? '',
    });
  }
  return rows.sort((a, b) => b.hours - a.hours).slice(0, 40);
}

export function readLabel(text: string) {
  const source = text.replace(/\r/g, '').trim();
  if (source.length < 3) throw new Error('Pega el texto de la etiqueta.');
  const lines = source.split('\n').map((line) => line.trim()).filter(Boolean);
  const attributes: ProductAttribute[] = [];
  for (const line of lines) {
    const split = line.split(/[:：]/);
    if (split.length < 2) continue;
    const name = split[0].trim();
    const value = split.slice(1).join(':').trim();
    if (name && value && name.length <= 40) attributes.push({ name, value });
  }
  const presentations = PRESENTATIONS.filter((item) => source.toLowerCase().includes(item.toLowerCase()));
  const warnings = HAZARD_WORDS.filter(([pattern]) => pattern.test(source)).map(([, label]) => label);
  return {
    name: lines[0]?.slice(0, 80) ?? '',
    presentations,
    hazardous: warnings.length > 0,
    warnings,
    attributes: attributes.slice(0, 12),
  };
}

export function saveOffering(
  s: AppState,
  body: { supplierId?: string; productId?: string; supplierSku?: string; unitCost?: number | string; minQty?: number | string },
) {
  ensureOutbound(s);
  const supplier = s.suppliers?.find((item) => item.id === body.supplierId);
  const item = product(s, String(body.productId ?? ''));
  if (!supplier) throw new Error('Proveedor no encontrado.');
  if (!item) throw new Error('Producto no encontrado.');
  const supplierSku = String(body.supplierSku ?? '').trim();
  if (!supplierSku) throw new Error('Indica el código del proveedor.');
  const unitCost = Number(body.unitCost);
  const minQty = Number(body.minQty);
  if (!Number.isFinite(unitCost) || unitCost < 0) throw new Error('El costo no puede ser negativo.');
  if (!Number.isInteger(minQty) || minQty <= 0) throw new Error('El pedido mínimo debe ser un entero mayor que cero.');
  if (s.offerings!.some((offer) => offer.supplierId === supplier.id && offer.productId === item.id)) {
    throw new Error('Ese proveedor ya tiene este producto en su catálogo.');
  }
  const offering: SupplierOffering = {
    id: nextNumber(s.offerings!.map((offer) => offer.id), 'OF-', 4),
    supplierId: supplier.id,
    productId: item.id,
    supplierSku,
    unitCost: Math.round(unitCost * 100) / 100,
    minQty,
  };
  s.offerings!.push(offering);
  return offering;
}

export function removeOffering(s: AppState, id: string) {
  ensureOutbound(s);
  if (!s.offerings!.some((offer) => offer.id === id)) throw new Error('El producto del proveedor no existe.');
  s.offerings = s.offerings!.filter((offer) => offer.id !== id);
}
