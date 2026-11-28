/**
 * Empaque y carga.
 *
 * Un pedido `Preparado` se reparte en bultos (qué producto y lote va en cada uno),
 * el empaque se cierra y luego se confirma la carga de un camión. El estado del
 * pedido no cambia: el avance vive en `order.packing` y `order.stagedPlate`.
 */
import { hazardOf, hazardsConflict, HAZARD_LABEL } from './hazard.js';
import { stageOrders, unstageOrders } from './commerce.service.js';
import { addEvent, client, product } from './inventory.service.js';
import { currentActor } from './request-context.js';
import { resolveBusinessRules } from './business-rules.js';
import type { AppState, Order, PackingBox, Parcel, ParcelContent, ParcelDims, Product } from './types.js';

/** Cajas de partida. Cada empresa las ajusta en Reglas de negocio. `custom` admite cualquier medida. */
export const DEFAULT_BOXES: PackingBox[] = [
  { code: 'S', label: 'Caja S', dims: { l: 40, w: 30, h: 30 }, tareKg: 0.4 },
  { code: 'M', label: 'Caja M', dims: { l: 60, w: 40, h: 40 }, tareKg: 0.4 },
  { code: 'G', label: 'Caja G', dims: { l: 80, w: 60, h: 50 }, tareKg: 0.4 },
];

export const boxCatalog = (s: AppState): PackingBox[] =>
  s.settings.packingBoxes?.length ? s.settings.packingBoxes : DEFAULT_BOXES;

const round = (n: number, decimals: number) => Math.round(n * 10 ** decimals) / 10 ** decimals;
const keyOf = (productId: string, batch: string | undefined) => `${productId}|${batch ?? ''}`;

function ensureParcels(s: AppState) {
  if (!s.parcels) s.parcels = [];
  return s.parcels;
}

export const parcelsOf = (s: AppState, orderId: string) =>
  (s.parcels ?? []).filter((parcel) => parcel.orderId === orderId);

function findOrder(s: AppState, orderId: string) {
  const order = s.orders.find((item) => item.id === orderId);
  if (!order) throw new Error('Pedido no encontrado.');
  return order;
}

/** Pedido cuyo empaque todavía se puede cambiar. */
function editableOrder(s: AppState, orderId: string) {
  const order = findOrder(s, orderId);
  if (order.status !== 'Preparado') throw new Error('Solo se empaca un pedido preparado.');
  if (order.packing) throw new Error('El empaque está cerrado. Reábrelo para cambiarlo.');
  if (!order.picks?.length) throw new Error('El pedido no tiene lotes de salida. Prepáralo antes de empacar.');
  return order;
}

function findParcel(s: AppState, parcelId: string) {
  const parcel = ensureParcels(s).find((item) => item.id === parcelId);
  if (!parcel) throw new Error('Bulto no encontrado.');
  return parcel;
}

/** Unidades preparadas por producto y lote. */
function pickedUnits(order: Order) {
  const map = new Map<string, number>();
  for (const pick of order.picks ?? []) {
    const key = keyOf(pick.productId, pick.batch);
    map.set(key, (map.get(key) ?? 0) + pick.qty);
  }
  return map;
}

function packedUnits(parcels: Parcel[]) {
  const map = new Map<string, number>();
  for (const parcel of parcels) {
    for (const line of parcel.contents ?? []) {
      const key = keyOf(line.productId, line.batch);
      map.set(key, (map.get(key) ?? 0) + line.qty);
    }
  }
  return map;
}

const boxOf = (s: AppState, code: string | undefined) => boxCatalog(s).find((box) => box.code === code);

function cleanSides(dims: ParcelDims | undefined): ParcelDims {
  const out = { l: Number(dims?.l), w: Number(dims?.w), h: Number(dims?.h) };
  if (![out.l, out.w, out.h].every((n) => Number.isFinite(n) && n > 0 && n <= 400)) {
    throw new Error('Las medidas del bulto van en centímetros, entre 1 y 400.');
  }
  return out;
}

/** Medidas y peso vacío según la caja elegida. */
function boxData(s: AppState, boxCode: string, dims: ParcelDims | undefined) {
  const preset = boxOf(s, boxCode);
  if (preset) return { dims: { ...preset.dims }, tareKg: preset.tareKg };
  if (boxCode !== 'custom') throw new Error('Tipo de caja desconocido.');
  return { dims: cleanSides(dims), tareKg: 0 };
}

/** Valida el catálogo que se guarda en Reglas de negocio. */
export function cleanPackingBoxes(input: unknown): PackingBox[] {
  if (!Array.isArray(input) || !input.length) throw new Error('Deja al menos un tipo de caja.');
  if (input.length > 20) throw new Error('Máximo 20 tipos de caja.');
  const codes = new Set<string>();
  return (input as Array<Partial<PackingBox>>).map((raw) => {
    const code = String(raw?.code ?? '').trim().slice(0, 24);
    const label = String(raw?.label ?? '').trim().slice(0, 40);
    if (!code || !label) throw new Error('Cada caja necesita un nombre.');
    if (code === 'custom' || codes.has(code)) throw new Error(`El código de caja «${code}» está repetido o reservado.`);
    codes.add(code);
    const tareKg = Number(raw?.tareKg);
    if (!Number.isFinite(tareKg) || tareKg < 0 || tareKg > 200) {
      throw new Error(`${label}: el peso vacío va entre 0 y 200 kg.`);
    }
    return { code, label, dims: cleanSides(raw?.dims), tareKg: round(tareKg, 2) };
  });
}

const volumeOf = (dims: ParcelDims) => round((dims.l * dims.w * dims.h) / 1_000_000, 3);

/** Peso del catálogo de lo que hay dentro más la caja vacía. */
export function expectedWeight(s: AppState, parcel: Pick<Parcel, 'boxCode' | 'contents' | 'tareKg'>) {
  const content = (parcel.contents ?? []).reduce(
    (sum, line) => sum + line.qty * (product(s, line.productId)?.weight ?? 0),
    0,
  );
  return round(content + (parcel.tareKg ?? boxOf(s, parcel.boxCode)?.tareKg ?? 0), 2);
}

export function weightDiffers(s: AppState, parcel: Parcel) {
  const expected = expectedWeight(s, parcel);
  if (expected <= 0 || !(parcel.weightKg > 0)) return false;
  const tolerance = resolveBusinessRules(s.settings).packTolerancePct / 100;
  return Math.abs(parcel.weightKg - expected) / expected > tolerance + 1e-9;
}

function assertCompatible(s: AppState, contents: ParcelContent[]) {
  const items = contents.map((line) => product(s, line.productId)!);
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = hazardOf(items[i]);
      const b = hazardOf(items[j]);
      if (hazardsConflict(a, b)) {
        throw new Error(
          `No se puede juntar ${items[i].name} (${HAZARD_LABEL[a]}) con ${items[j].name} (${HAZARD_LABEL[b]}) en el mismo bulto.`,
        );
      }
    }
  }
}

/** Une líneas repetidas y comprueba que no se empaque más de lo preparado. */
function cleanContents(s: AppState, order: Order, parcelId: string, input: ParcelContent[]) {
  const merged = new Map<string, ParcelContent>();
  for (const raw of input) {
    const qty = Number(raw?.qty);
    if (!Number.isInteger(qty) || qty < 0) throw new Error('La cantidad en el bulto debe ser un entero.');
    if (!qty) continue;
    const productId = String(raw.productId ?? '');
    const batch = String(raw.batch ?? '');
    const key = keyOf(productId, batch);
    const current = merged.get(key);
    if (current) current.qty += qty;
    else merged.set(key, { productId, batch, qty });
  }
  const picked = pickedUnits(order);
  const elsewhere = packedUnits(parcelsOf(s, order.id).filter((parcel) => parcel.id !== parcelId));
  for (const [key, line] of merged) {
    const name = product(s, line.productId)?.name ?? line.productId;
    if (!picked.has(key)) throw new Error(`${name} (lote ${line.batch || 's/l'}) no está en este pedido.`);
    if ((elsewhere.get(key) ?? 0) + line.qty > picked.get(key)!) {
      throw new Error(`${name}: hay más unidades en bultos que las preparadas.`);
    }
  }
  const contents = [...merged.values()];
  assertCompatible(s, contents);
  return contents;
}

export function createParcel(
  s: AppState,
  body: { orderId: string; boxCode?: string; dims?: ParcelDims },
) {
  const order = editableOrder(s, body.orderId);
  const boxCode = body.boxCode || 'M';
  const { dims, tareKg } = boxData(s, boxCode, body.dims);
  const parcels = ensureParcels(s);
  const n = parcels.reduce((max, item) => Math.max(max, Number(item.id.replace(/\D/g, '')) || 0), 0) + 1;
  const parcel: Parcel = {
    id: `BUL-${String(n).padStart(4, '0')}`,
    orderId: order.id,
    boxCode,
    dims,
    tareKg,
    contents: [],
    weightKg: 0,
    volumeM3: volumeOf(dims),
    packedAt: new Date().toISOString(),
    packedBy: currentActor()?.name,
  };
  parcels.push(parcel);
  return parcel;
}

export function updateParcel(
  s: AppState,
  parcelId: string,
  patch: {
    boxCode?: string;
    dims?: ParcelDims;
    contents?: ParcelContent[];
    weightKg?: number | string;
    weightNote?: string;
  },
) {
  const parcel = findParcel(s, parcelId);
  const order = editableOrder(s, parcel.orderId);
  // Se valida todo antes de tocar el bulto.
  const next: Partial<Parcel> = {};
  if (patch.boxCode !== undefined || patch.dims !== undefined) {
    const boxCode = patch.boxCode ?? parcel.boxCode ?? 'custom';
    const { dims, tareKg } = boxData(s, boxCode, patch.dims ?? parcel.dims);
    Object.assign(next, { boxCode, dims, tareKg, volumeM3: volumeOf(dims) });
  }
  if (patch.contents !== undefined) next.contents = cleanContents(s, order, parcel.id, patch.contents);
  if (patch.weightKg !== undefined) {
    const weight = Number(patch.weightKg);
    if (!Number.isFinite(weight) || weight < 0 || weight > 5000) throw new Error('El peso del bulto no es válido.');
    next.weightKg = round(weight, 2);
  }
  if (patch.weightNote !== undefined) next.weightNote = String(patch.weightNote).trim() || undefined;
  Object.assign(parcel, next);
  return parcel;
}

export function deleteParcel(s: AppState, parcelId: string) {
  const parcel = findParcel(s, parcelId);
  editableOrder(s, parcel.orderId);
  s.parcels = ensureParcels(s).filter((item) => item.id !== parcelId);
}

/** Unidades verificadas de un lote: lo contado o, si es más, lo que ya está en bultos. */
function verifiedUnits(s: AppState, order: Order, key: string) {
  const picked = pickedUnits(order).get(key) ?? 0;
  const packed = packedUnits(parcelsOf(s, order.id)).get(key) ?? 0;
  return Math.min(picked, Math.max(order.packCounts?.[key] ?? 0, packed));
}

export function countUnits(
  s: AppState,
  orderId: string,
  body: { productId: string; batch?: string; qty: number | string },
) {
  const order = editableOrder(s, orderId);
  const key = keyOf(String(body.productId ?? ''), body.batch);
  const picked = pickedUnits(order).get(key);
  if (!picked) throw new Error('Ese producto o lote no está en este pedido.');
  const qty = Number(body.qty);
  if (!Number.isInteger(qty) || qty < 0 || qty > picked) {
    throw new Error(`El conteo va entre 0 y ${picked} unidades.`);
  }
  order.packCounts = { ...order.packCounts, [key]: qty };
  return order;
}

/** Busca por código de barras, SKU o código interno (coincidencia exacta). */
export function productByCode(s: AppState, code: string): Product | undefined {
  const wanted = code.trim().toUpperCase();
  if (!wanted) return undefined;
  const same = (value: string | undefined) => value?.trim().toUpperCase() === wanted;
  return (
    s.products.find((item) => same(item.barcode)) ??
    s.products.find((item) => same(item.sku)) ??
    s.products.find((item) => same(item.id))
  );
}

/** Una lectura del escáner cuenta una unidad. */
export function scanUnit(s: AppState, orderId: string, code: string) {
  const order = editableOrder(s, orderId);
  const item = productByCode(s, String(code ?? ''));
  if (!item) throw new Error(`No hay ningún producto con el código «${String(code ?? '').trim()}».`);
  const lines = (order.picks ?? []).filter((pick) => pick.productId === item.id);
  if (!lines.length) throw new Error(`${item.name} no está en este pedido.`);
  for (const pick of lines) {
    const key = keyOf(item.id, pick.batch);
    const done = verifiedUnits(s, order, key);
    if (done < pickedUnits(order).get(key)!) {
      countUnits(s, orderId, { productId: item.id, batch: pick.batch, qty: done + 1 });
      return item;
    }
  }
  throw new Error(`${item.name} ya está completo: no escanees unidades de más.`);
}

/** Lo que falta para poder cerrar el empaque; lista vacía = listo. */
export function packingProblems(s: AppState, order: Order): string[] {
  const parcels = parcelsOf(s, order.id);
  if (!parcels.length) return ['Crea al menos un bulto.'];
  const problems: string[] = [];
  if (parcels.some((parcel) => !parcel.contents)) problems.push('Hay bultos sin detalle de contenido: quítalos y vuelve a armarlos.');
  else if (parcels.some((parcel) => !parcel.contents!.length)) problems.push('Hay un bulto vacío.');
  const packed = packedUnits(parcels);
  let missing = 0;
  for (const [key, qty] of pickedUnits(order)) missing += qty - (packed.get(key) ?? 0);
  if (missing > 0) problems.push(`Faltan ${missing} unidades por meter en un bulto.`);
  if (parcels.some((parcel) => !(parcel.weightKg > 0))) problems.push('Hay bultos sin pesar.');
  if (parcels.some((parcel) => weightDiffers(s, parcel) && !parcel.weightNote)) {
    problems.push('Hay una diferencia de peso sin motivo.');
  }
  return problems;
}

export function closePacking(s: AppState, orderId: string) {
  const order = editableOrder(s, orderId);
  const problems = packingProblems(s, order);
  if (problems.length) throw new Error(problems[0]);
  const parcels = parcelsOf(s, orderId);
  for (const parcel of parcels) assertCompatible(s, parcel.contents!);
  order.packing = { closedAt: new Date().toISOString(), closedBy: currentActor()?.name };
  const first = order.picks![0];
  const units = order.picks!.reduce((sum, pick) => sum + pick.qty, 0);
  addEvent(s, 'Empaque', first.productId, units, 'Zona de despacho', `${parcels.length} bulto(s)`, order.id, first.batch ?? '');
  return order;
}

export function reopenPacking(s: AppState, orderId: string) {
  const order = findOrder(s, orderId);
  if (order.status !== 'Preparado' || !order.packing) throw new Error('El pedido no tiene un empaque cerrado.');
  if (order.stagedPlate) {
    throw new Error(`El pedido está cargado en ${order.stagedPlate}. Retira la carga antes de reabrir.`);
  }
  delete order.packing;
  const first = order.picks?.[0];
  addEvent(s, 'Empaque reabierto', first?.productId ?? '', 0, 'Zona de despacho', 'En empaque', order.id, first?.batch ?? '');
  return order;
}

/** Al cancelar un pedido sus bultos dejan de existir. */
export function discardPacking(s: AppState, order: Order) {
  if (s.parcels) s.parcels = s.parcels.filter((parcel) => parcel.orderId !== order.id);
  delete order.packing;
  delete order.packCounts;
  delete order.loadNote;
  order.stopOrder = undefined;
}

/**
 * Deja la carga de un camión tal como se confirma: `orderIds` va en orden de entrega.
 * Reemplaza la carga anterior de esa placa. Si algo falla no cambia nada, siempre que
 * se ejecute dentro de una transacción del repositorio.
 */
export function confirmLoad(
  s: AppState,
  body: { plate: string; orderIds: string[]; outOfZone?: string[]; reason?: string },
) {
  const plate = String(body.plate ?? '').trim().toUpperCase();
  const ids = [...new Set(body.orderIds)];
  if (!ids.length) throw new Error('Sube al menos un pedido al camión.');
  const orders = ids.map((id) => findOrder(s, id));
  for (const order of orders) {
    if (order.status !== 'Preparado') throw new Error(`${order.id} no está preparado.`);
    if (!order.packing) throw new Error(`${order.id} todavía no tiene el empaque cerrado.`);
    if (order.stagedPlate && order.stagedPlate.toUpperCase() !== plate) {
      throw new Error(`${order.id} ya está cargado en ${order.stagedPlate}.`);
    }
  }
  const reason = String(body.reason ?? '').trim();
  const outOfZone = (body.outOfZone ?? []).filter((id) => ids.includes(id));
  if (outOfZone.length && !reason) {
    throw new Error(`${outOfZone.join(', ')} está fuera de la zona del camión. Indica el motivo para cargarlo.`);
  }
  const previous = s.orders.filter((o) => o.status === 'Preparado' && o.stagedPlate?.toUpperCase() === plate);
  for (const order of previous) {
    unstageOrders(s, [order.id]);
    order.stopOrder = undefined;
    delete order.loadNote;
  }
  stageOrders(s, ids, plate);
  orders.forEach((order, index) => {
    order.stopOrder = index + 1;
    if (outOfZone.includes(order.id)) order.loadNote = reason;
    else delete order.loadNote;
    const first = order.picks?.[0];
    addEvent(s, 'Carga', first?.productId ?? '', 0, 'Zona de despacho', `${plate} · parada ${index + 1}`, order.id, first?.batch ?? '');
  });
  return orders;
}

export function releaseLoad(s: AppState, plate: string) {
  const wanted = String(plate ?? '').trim().toUpperCase();
  const staged = s.orders.filter((o) => o.status === 'Preparado' && o.stagedPlate?.toUpperCase() === wanted);
  if (!staged.length) throw new Error('Ese camión no tiene carga confirmada.');
  unstageOrders(s, staged.map((o) => o.id));
  for (const order of staged) {
    order.stopOrder = undefined;
    delete order.loadNote;
    const first = order.picks?.[0];
    addEvent(s, 'Descarga', first?.productId ?? '', 0, wanted, 'Zona de despacho', order.id, first?.batch ?? '');
  }
}

/** Regla "el despacho exige empaque" (se puede apagar en Reglas de negocio). */
export function assertPackedForDispatch(s: AppState, orderIds: string[]) {
  if (!resolveBusinessRules(s.settings).requirePackingBeforeDispatch) return;
  const unpacked = s.orders.filter((o) => orderIds.includes(o.id) && o.status === 'Preparado' && !o.packing);
  if (unpacked.length) {
    const names = unpacked.map((o) => `${o.id} (${client(s, o.clientId)?.name ?? o.clientId})`).join(', ');
    throw new Error(`Falta empacar antes de despachar: ${names}. Ciérralo en Empaque.`);
  }
}
