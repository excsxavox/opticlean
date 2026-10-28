import { getWarehouseGeometry } from './warehouse-layout.js';
import type { AppState, Lot, Order, OrderLine, Product } from './types.js';
import { activeWarehouseId, lotsForActiveWarehouse } from './warehouse-admin.service.js';

export const uid = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export const product = (s: AppState, id: string) => s.products.find((p) => p.id === id);

export const client = (s: AppState, id: string) => s.clients.find((c) => c.id === id);

export const stock = (s: AppState, id: string) =>
  lotsForActiveWarehouse(s)
    .filter((l) => l.productId === id)
    .reduce((n, l) => n + l.qty, 0);

export const reserved = (s: AppState, id: string) =>
  s.orders
    .filter((o) => o.status === 'Por preparar')
    .reduce(
      (n, o) => n + o.lines.filter((l) => l.productId === id).reduce((a, l) => a + l.qty, 0),
      0,
    );

export const available = (s: AppState, id: string) => stock(s, id) - reserved(s, id);

export const qtyAt = (s: AppState, loc: string) =>
  lotsForActiveWarehouse(s)
    .filter((l) => l.loc === loc)
    .reduce((n, l) => n + l.qty, 0);

export const orderValue = (s: AppState, o: { lines: OrderLine[] }) =>
  o.lines.reduce((n, l) => n + l.qty * (product(s, l.productId)?.price ?? 0), 0);

export const orderWeight = (s: AppState, o: Order) =>
  o.lines.reduce((n, l) => n + l.qty * (product(s, l.productId)?.weight ?? 0), 0);

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
    by: s.settings.operator,
  });
}

export function suggest(s: AppState, productId: string, qty = 1, exclude = '') {
  const p = product(s, productId);
  if (!p) return [];
  return getWarehouseGeometry(s)
    .locations.filter(
      (l) =>
        l.id !== exclude &&
        qtyAt(s, l.id) + qty <= l.capacity &&
        lotsForActiveWarehouse(s)
          .filter((t) => t.loc === l.id)
          .every((t) => t.productId === productId),
    )
    .sort((a, b) => {
      const score = (l: typeof a) =>
        (l.category === p.category ? 100 : 0) +
        (lotsForActiveWarehouse(s).some((t) => t.loc === l.id && t.productId === productId)
          ? 40
          : 0) +
        (4 - l.level) * 3 +
        (l.rack < 'D' ? 2 : 0);
      return score(b) - score(a);
    });
}

const todayGuayaquil = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guayaquil' });

export function receive(
  s: AppState,
  data: {
    productId: string;
    qty: number | string;
    loc: string;
    batch: string;
    expiry: string;
    supplier: string;
  },
) {
  const qty = Number(data.qty);
  const target = getWarehouseGeometry(s).locations.find((l) => l.id === data.loc);
  if (!product(s, data.productId) || !Number.isInteger(qty) || qty <= 0 || !target) {
    throw new Error('Selecciona un producto, una ubicación y una cantidad entera mayor a cero.');
  }
  if (qtyAt(s, data.loc) + qty > target.capacity) {
    throw new Error('La cantidad supera la capacidad de esta ubicación (60 unidades).');
  }
  if (
    lotsForActiveWarehouse(s).some((l) => l.loc === data.loc && l.productId !== data.productId)
  ) {
    throw new Error('Esta ubicación contiene otro producto. Selecciona una ubicación compatible.');
  }
  if (!data.batch?.trim() || !data.expiry) {
    throw new Error('Completa el lote y la fecha de vencimiento.');
  }
  if (data.expiry < todayGuayaquil()) {
    throw new Error('La fecha de vencimiento no puede estar en el pasado.');
  }
  const id = `REC-${String(84 + s.receipts.length - 1).padStart(4, '0')}`;
  s.lots.push({
    id: uid('lot'),
    productId: data.productId,
    qty,
    loc: data.loc,
    batch: data.batch.trim(),
    expiry: data.expiry,
    warehouseId: activeWarehouseId(s),
  });
  s.receipts.unshift({
    id,
    productId: data.productId,
    qty,
    loc: data.loc,
    batch: data.batch.trim(),
    supplier: data.supplier,
    date: new Date().toISOString().slice(0, 10),
  });
  addEvent(s, 'Recepción', data.productId, qty, data.supplier, data.loc, id, data.batch.trim());
  return id;
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
  if (qtyAt(s, data.to) + qty > target.capacity) {
    throw new Error('La ubicación de destino no tiene capacidad suficiente.');
  }
  if (
    lotsForActiveWarehouse(s).some((l) => l.loc === data.to && l.productId !== lot.productId)
  ) {
    throw new Error('El destino contiene otro producto.');
  }
  const from = lot.loc;
  lot.qty -= qty;
  s.lots.push({ ...lot, id: uid('lot'), qty, loc: data.to });
  s.lots = s.lots.filter((l) => l.qty > 0);
  addEvent(s, 'Traslado', lot.productId, qty, from, data.to, uid('MOV'), lot.batch);
}

export function createOrder(
  s: AppState,
  data: { clientId: string; lines: OrderLine[]; priority?: string },
) {
  if (!client(s, data.clientId) || !data.lines.length) {
    throw new Error('Selecciona un cliente y al menos un producto.');
  }
  const grouped = new Map<string, number>();
  for (const l of data.lines) {
    grouped.set(l.productId, (grouped.get(l.productId) ?? 0) + Number(l.qty));
  }
  const lines = [...grouped.entries()].map(([productId, qty]) => ({ productId, qty }));
  for (const l of lines) {
    if (
      !product(s, l.productId) ||
      !Number.isInteger(l.qty) ||
      l.qty <= 0 ||
      l.qty > available(s, l.productId)
    ) {
      throw new Error(
        `Stock insuficiente o cantidad inválida para ${product(s, l.productId)?.name ?? 'el producto'}.`,
      );
    }
  }
  const n = Math.max(1048, ...s.orders.map((o) => Number(o.id.split('-')[1]))) + 1;
  const o: Order = {
    id: `PED-${n}`,
    clientId: data.clientId,
    lines,
    priority: data.priority ?? 'Normal',
    status: 'Por preparar',
    date: new Date().toISOString().slice(0, 10),
  };
  s.orders.unshift(o);
  return o;
}

export type PickPlanLine = Lot & { qty: number };

export function pickPlan(s: AppState, order: Order): PickPlanLine[] {
  const plan: PickPlanLine[] = [];
  const today = todayGuayaquil();
  for (const line of order.lines) {
    let left = line.qty;
    const lots = lotsForActiveWarehouse(s)
      .filter((l) => l.productId === line.productId && l.qty > 0 && l.expiry >= today)
      .sort((a, b) => a.expiry.localeCompare(b.expiry));
    for (const l of lots) {
      if (!left) break;
      const qty = Math.min(l.qty, left);
      plan.push({ ...l, qty });
      left -= qty;
    }
    if (left) {
      throw new Error(`Faltan ${left} unidades de ${product(s, line.productId)?.name}.`);
    }
  }
  return plan.sort((a, b) => a.loc.localeCompare(b.loc));
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
  }));
  o.status = 'Preparado';
  return o;
}

export function dispatch(s: AppState, ids: string[], vehicle: string) {
  const orders = s.orders.filter((o) => ids.includes(o.id));
  if (!orders.length || orders.some((o) => o.status !== 'Preparado')) {
    throw new Error('Selecciona pedidos preparados.');
  }
  const current = s.orders.filter(
    (o) => o.vehicle === vehicle && ['En ruta', 'Incidencia'].includes(o.status),
  );
  const all = [...current, ...orders];
  if (all.reduce((n, o) => n + orderWeight(s, o), 0) > 650) {
    throw new Error('La carga supera la capacidad de 650 kg del vehículo.');
  }
  if (
    all.reduce(
      (n, o) =>
        n + o.lines.reduce((v, l) => v + l.qty * (product(s, l.productId)?.volume ?? 0), 0),
      0,
    ) > 8000
  ) {
    throw new Error('La carga supera la capacidad de 8 m³ del vehículo.');
  }
  for (const o of orders) {
    o.status = 'En ruta';
    o.vehicle = vehicle;
    for (const line of o.picks ?? o.lines) {
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

export function upsertProduct(s: AppState, p: Product, originalId?: string) {
  if (originalId) {
    const existing = product(s, originalId);
    if (!existing) throw new Error('Producto no encontrado.');
    Object.assign(existing, p);
    return existing;
  }
  if (s.products.some((x) => x.id === p.id)) {
    throw new Error('Ya existe un producto con este código.');
  }
  s.products.push(p);
  return p;
}

export function confirmDelivery(
  s: AppState,
  orderId: string,
  person: string,
  notes?: string,
) {
  const o = s.orders.find((x) => x.id === orderId);
  if (!o || !['En ruta', 'Incidencia'].includes(o.status)) {
    throw new Error('El pedido no está en ruta.');
  }
  if (!person.trim()) throw new Error('Escribe el nombre de quien recibe.');
  o.status = 'Entregado';
  o.deliveredTo = person.trim();
  o.deliveryNotes = notes;
  o.deliveredAt = new Date().toISOString();
  for (const line of o.picks ?? o.lines) {
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
  for (const line of o.picks ?? o.lines) {
    addEvent(s, 'Novedad', line.productId, line.qty, o.id, reason, o.id, line.batch ?? '');
  }
  return o;
}
