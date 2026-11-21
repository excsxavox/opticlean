import type {
  AdjustmentKind,
  AppState,
  CreditNote,
  CycleCount,
  DeliveryGuide,
  PayMethod,
  PriceList,
  SalesInvoice,
  WarehouseTransfer,
} from './types.js';
import {
  actorName,
  addEvent,
  assertCanSell,
  available,
  client,
  product,
  todayGuayaquil,
  uid,
} from './inventory.service.js';
import { createPurchase } from './commerce.service.js';
import { hazardsConflict, HAZARD_LABEL } from './hazard.js';
import { packsOf } from './packs.js';
import { activeWarehouseId } from './warehouse-admin.service.js';
import { buildWarehouseGeometry, normalizeLayout } from './warehouse-layout.js';
import { resolveBusinessRules } from './business-rules.js';
import {
  IVA_RATE,
  QUARANTINE_LOC,
  billBalance,
  demoAccessKey,
  invoiceBalance,
  invoiceTotals,
  lineTotals,
  roundMoney,
  isSellableLoc,
} from './ledger.js';

/** Tarifa de IVA del producto; la general si no tiene una propia. */
export function productIvaRate(item: { ivaRate?: number } | undefined) {
  const rate = item?.ivaRate;
  return rate != null && Number.isFinite(rate) && rate >= 0 && rate < 1 ? rate : IVA_RATE;
}

const PAY_METHODS = new Set<PayMethod>(['Transferencia', 'Efectivo', 'Cheque', 'Retención']);
const ADJUST_KINDS = new Set<AdjustmentKind>(['Merma', 'Daño', 'Vencimiento', 'Conteo', 'Cuarentena']);

export function ensureCommercial(s: AppState) {
  s.invoices ??= [];
  s.creditNotes ??= [];
  s.guides ??= [];
  s.customerPayments ??= [];
  s.supplierBills ??= [];
  s.supplierPayments ??= [];
  s.priceLists ??= [];
  s.clientPrices ??= [];
  s.supplierReturns ??= [];
  s.adjustments ??= [];
  s.cycleCounts ??= [];
  s.transfers ??= [];
  for (const buyer of s.clients) {
    if (buyer.paymentTermsDays == null || !Number.isFinite(buyer.paymentTermsDays) || buyer.paymentTermsDays < 0) {
      buyer.paymentTermsDays = 30;
    }
  }
}

function today() {
  return todayGuayaquil();
}

function nextSeq(ids: string[]) {
  return ids.reduce((max, id) => Math.max(max, Number(id.replace(/\D/g, '')) || 0), 0) + 1;
}

function fiscalNumber(n: number) {
  return `001-001-${String(n).padStart(9, '0')}`;
}

function moneyOf(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error('El monto debe ser un número mayor o igual a cero.');
  return roundMoney(n);
}

function positiveInt(value: unknown, label = 'La cantidad') {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${label} debe ser un entero mayor que cero.`);
  return n;
}

function payMethod(value: unknown): PayMethod {
  const method = String(value || 'Transferencia') as PayMethod;
  if (!PAY_METHODS.has(method)) throw new Error('Elige un método de pago válido.');
  return method;
}

function warehouseName(s: AppState, id: string) {
  const site = s.warehouses.find((warehouse) => warehouse.id === id);
  return site ? `${site.name} · ${site.city}` : id;
}

function assertSanitary(s: AppState, productId: string) {
  assertCanSell(s, productId);
}

function missingPick(orderId: string): never {
  throw new Error(`Prepara ${orderId} antes de despachar: falta el lote de salida.`);
}

function takePicks(
  orderId: string,
  pool: Array<{ productId: string; qty: number; batch?: string; expiry?: string }>,
  productId: string,
  qty: number,
) {
  let left = qty;
  const parts: Array<{ qty: number; batch: string; expiry?: string }> = [];
  for (const pick of pool) {
    if (left <= 0) break;
    if (pick.productId !== productId || pick.qty <= 0) continue;
    const batch = pick.batch?.trim();
    if (!batch) missingPick(orderId);
    const take = Math.min(pick.qty, left);
    parts.push({ qty: take, batch, ...(pick.expiry ? { expiry: pick.expiry } : {}) });
    pick.qty -= take;
    left -= take;
  }
  if (left > 0) missingPick(orderId);
  return parts;
}

export function issueInvoice(s: AppState, orderId: string) {
  ensureCommercial(s);
  const order = s.orders.find((item) => item.id === orderId);
  if (!order || order.id.startsWith('PED-H')) throw new Error('Pedido no encontrado.');
  if (!['Preparado', 'En ruta', 'Entregado'].includes(order.status)) {
    throw new Error('La factura se emite cuando el pedido ya está preparado.');
  }
  if (s.invoices!.some((invoice) => invoice.orderId === orderId && invoice.status === 'Emitida')) {
    throw new Error('Este pedido ya tiene una factura emitida.');
  }
  const buyer = client(s, order.clientId);
  if (!buyer?.taxId || !/^\d{13}$/.test(buyer.taxId)) {
    throw new Error('El cliente necesita un RUC de 13 dígitos para facturar.');
  }
  for (const line of order.lines) assertSanitary(s, line.productId);
  const pool = (order.picks ?? []).map((pick) => ({ ...pick }));
  if (!pool.length) missingPick(order.id);
  const lines = order.lines.flatMap((line) => {
    const item = product(s, line.productId);
    return takePicks(order.id, pool, line.productId, line.qty).map((part) => ({
      productId: line.productId,
      qty: part.qty,
      unitPrice: line.unitPrice ?? item?.price ?? 0,
      ivaRate: productIvaRate(item),
      ...(item?.avgCost ? { unitCost: item.avgCost } : {}),
      batch: part.batch,
      ...(part.expiry ? { expiry: part.expiry } : {}),
    }));
  });
  for (const kit of order.kits ?? []) {
    const bundle = s.bundles?.find((item) => item.id === kit.bundleId);
    if (!bundle) continue;
    for (const component of bundle.lines) {
      takePicks(order.id, pool, component.productId, component.qty * kit.qty);
    }
  }
  const kits = (order.kits ?? []).map((kit) => ({
    bundleId: kit.bundleId,
    qty: kit.qty,
    unitPrice: s.bundles?.find((bundle) => bundle.id === kit.bundleId)?.price ?? 0,
    ivaRate: IVA_RATE,
  }));
  if (!lines.length && !kits.length) throw new Error('El pedido no tiene líneas para facturar.');
  const totals = invoiceTotals({ lines, kits });
  const n = nextSeq(s.invoices!.map((invoice) => invoice.id));
  const date = today();
  const invoice: SalesInvoice = {
    id: `FAC-${String(n).padStart(4, '0')}`,
    number: fiscalNumber(n),
    accessKey: demoAccessKey(date, '01', n),
    orderId,
    clientId: order.clientId,
    date,
    status: 'Emitida',
    lines,
    kits: kits.length ? kits : undefined,
    ...totals,
  };
  s.invoices!.unshift(invoice);
  addEvent(s, 'Factura', lines[0]?.productId ?? kits[0]?.bundleId ?? '', lines[0]?.qty ?? kits[0]?.qty ?? 0, 'Ventas', client(s, order.clientId)?.name ?? order.clientId, invoice.id);
  return invoice;
}

export function issueCreditNote(
  s: AppState,
  body: {
    invoiceId: string;
    reason: string;
    lines: Array<{ productId: string; qty: number | string; batch?: string; restock?: boolean }>;
  },
) {
  ensureCommercial(s);
  const invoice = s.invoices!.find((item) => item.id === body.invoiceId && item.status === 'Emitida');
  if (!invoice) throw new Error('Factura no encontrada.');
  const reason = body.reason?.trim();
  if (!reason) throw new Error('Indica el motivo de la nota de crédito.');
  if (!body.lines?.length) throw new Error('La nota de crédito necesita al menos un producto.');
  const order = s.orders.find((item) => item.id === invoice.orderId);
  const lines = body.lines.map((line) => {
    const qty = positiveInt(line.qty);
    const batchWanted = line.batch?.trim();
    const soldLines = invoice.lines.filter(
      (item) => item.productId === line.productId && (!batchWanted || item.batch === batchWanted),
    );
    const soldQty = soldLines.reduce((n, item) => n + item.qty, 0);
    if (!soldQty) throw new Error('El producto no está en la factura.');
    const already = s.creditNotes!
      .filter((note) => note.invoiceId === invoice.id && note.status === 'Emitida')
      .flatMap((note) => note.lines)
      .filter((item) => item.productId === line.productId && (!batchWanted || item.batch === batchWanted))
      .reduce((n, item) => n + item.qty, 0);
    if (qty + already > soldQty) throw new Error('La devolución supera lo facturado.');
    const sold = soldLines[0];
    const pick = order?.picks?.find((item) => item.productId === line.productId && (!batchWanted || item.batch === batchWanted));
    return {
      productId: line.productId,
      qty,
      unitPrice: sold.unitPrice,
      ivaRate: sold.ivaRate,
      batch: batchWanted || sold.batch || pick?.batch,
      expiry: sold.expiry || pick?.expiry,
      restock: line.restock !== false,
    };
  });
  const totals = lines.reduce(
    (acc, line) => {
      const part = lineTotals(line.qty, line.unitPrice, line.ivaRate);
      return {
        subtotal: roundMoney(acc.subtotal + part.subtotal),
        iva: roundMoney(acc.iva + part.iva),
        total: roundMoney(acc.total + part.total),
      };
    },
    { subtotal: 0, iva: 0, total: 0 },
  );
  if (totals.total > invoiceBalance(s, invoice.id) + 0.009) {
    throw new Error('La nota de crédito supera el saldo de la factura.');
  }
  const n = nextSeq(s.creditNotes!.map((note) => note.id));
  const date = today();
  const note: CreditNote = {
    id: `NC-${String(n).padStart(4, '0')}`,
    number: fiscalNumber(n),
    accessKey: demoAccessKey(date, '04', n),
    invoiceId: invoice.id,
    clientId: invoice.clientId,
    date,
    reason,
    status: 'Emitida',
    lines,
    ...totals,
  };
  s.creditNotes!.unshift(note);
  for (const line of lines) {
    if (!line.restock) continue;
    const expiry = line.expiry && line.expiry >= today() ? line.expiry : '2099-12-31';
    s.lots.push({
      id: uid('lot'),
      productId: line.productId,
      qty: line.qty,
      loc: QUARANTINE_LOC,
      batch: line.batch || `DEV-${note.id}`,
      expiry,
      warehouseId: activeWarehouseId(s),
      receivedAt: new Date().toISOString(),
    });
    addEvent(s, 'Devolución', line.productId, line.qty, client(s, invoice.clientId)?.name ?? 'Cliente', QUARANTINE_LOC, note.id, line.batch);
  }
  return note;
}

export function issueGuide(
  s: AppState,
  body: { orderId?: string; transferId?: string },
) {
  ensureCommercial(s);
  const date = today();
  let guide: DeliveryGuide;
  const n = nextSeq(s.guides!.map((item) => item.id));
  if (body.orderId) {
    const order = s.orders.find((item) => item.id === body.orderId);
    if (!order) throw new Error('Pedido no encontrado.');
    const existing = s.guides!.find((item) => item.orderId === order.id && item.kind === 'Venta' && item.status === 'Emitida');
    if (existing) return existing;
    if (!['Preparado', 'En ruta', 'Entregado'].includes(order.status)) {
      throw new Error('La guía se emite cuando el pedido ya está preparado.');
    }
    if (!order.picks?.length || order.picks.some((line) => !line.batch?.trim())) missingPick(order.id);
    const invoice = s.invoices!.find((item) => item.orderId === order.id && item.status === 'Emitida');
    guide = {
      id: `GR-${String(n).padStart(4, '0')}`,
      number: fiscalNumber(n),
      accessKey: demoAccessKey(date, '06', n),
      date,
      kind: 'Venta',
      orderId: order.id,
      invoiceId: invoice?.id,
      origin: s.settings.warehouse,
      destination: client(s, order.clientId)?.address || client(s, order.clientId)?.name || order.clientId,
      plate: order.vehicle,
      lines: order.picks.map((line) => ({
        productId: line.productId,
        qty: line.qty,
        batch: line.batch,
      })),
      status: 'Emitida',
    };
  } else if (body.transferId) {
    const transfer = s.transfers!.find((item) => item.id === body.transferId);
    if (!transfer || transfer.status === 'Cancelado') throw new Error('Traslado no encontrado.');
    guide = {
      id: `GR-${String(n).padStart(4, '0')}`,
      number: fiscalNumber(n),
      accessKey: demoAccessKey(date, '06', n),
      date,
      kind: 'Traslado',
      transferId: transfer.id,
      origin: warehouseName(s, transfer.fromWarehouseId),
      destination: warehouseName(s, transfer.toWarehouseId),
      lines: transfer.lines.map((line) => ({ productId: line.productId, qty: line.qty, batch: line.batch })),
      status: 'Emitida',
    };
  } else {
    throw new Error('Indica el pedido o el traslado de la guía.');
  }
  s.guides!.unshift(guide);
  return guide;
}

export function registerCustomerPayment(
  s: AppState,
  body: { invoiceId: string; amount: number | string; method?: string; reference?: string; date?: string },
) {
  ensureCommercial(s);
  const invoice = s.invoices!.find((item) => item.id === body.invoiceId && item.status === 'Emitida');
  if (!invoice) throw new Error('Factura no encontrada.');
  const amount = moneyOf(body.amount);
  if (amount <= 0) throw new Error('El abono debe ser mayor que cero.');
  const balance = invoiceBalance(s, invoice.id);
  if (amount > balance + 0.009) throw new Error('El abono supera el saldo de la factura.');
  const reference = body.reference?.trim();
  if (!reference) throw new Error('Indica la referencia del pago.');
  const n = nextSeq(s.customerPayments!.map((payment) => payment.id));
  const payment = {
    id: `COB-${String(n).padStart(4, '0')}`,
    clientId: invoice.clientId,
    invoiceId: invoice.id,
    date: body.date || today(),
    amount,
    method: payMethod(body.method),
    reference,
  };
  s.customerPayments!.unshift(payment);
  return payment;
}

function receivedValue(s: AppState, purchaseId: string) {
  const purchase = s.purchases.find((item) => item.id === purchaseId);
  if (!purchase) throw new Error('Orden de compra no encontrada.');
  // El precio de la OC es sin IVA; la factura del proveedor llega con IVA.
  const value = (purchase.lines ?? []).reduce((n, line) => {
    const perUnit = line.unitsPerPack > 0 ? line.unitPrice / line.unitsPerPack : 0;
    const base = (line.receivedUnits ?? 0) * perUnit;
    return n + base * (1 + productIvaRate(product(s, line.productId)));
  }, 0);
  return { purchase, value: roundMoney(value) };
}

export function registerSupplierBill(
  s: AppState,
  body: { purchaseId: string; number: string; total: number | string; date?: string },
) {
  ensureCommercial(s);
  const number = body.number?.trim();
  if (!number) throw new Error('Indica el número de factura del proveedor.');
  const { purchase, value } = receivedValue(s, body.purchaseId);
  if (!purchase.supplierId) throw new Error('La orden no tiene proveedor.');
  if ((purchase.received ?? 0) <= 0) throw new Error('Recibe la mercadería antes de registrar la factura del proveedor.');
  const total = moneyOf(body.total);
  if (total <= 0) throw new Error('El total de la factura debe ser mayor que cero.');
  if (value > 0 && total > value + 0.009) {
    throw new Error(`La factura supera lo recibido con IVA ($${value.toFixed(2)}).`);
  }
  const billed = s.supplierBills!
    .filter((bill) => bill.purchaseId === purchase.id)
    .reduce((n, bill) => n + bill.total, 0);
  if (value > 0 && billed + total > value + 0.009) {
    throw new Error('La suma de facturas supera lo recibido en la orden.');
  }
  const n = nextSeq(s.supplierBills!.map((bill) => bill.id));
  const bill = {
    id: `FPR-${String(n).padStart(4, '0')}`,
    supplierId: purchase.supplierId,
    purchaseId: purchase.id,
    number,
    date: body.date || today(),
    total,
  };
  s.supplierBills!.unshift(bill);
  return bill;
}

export function registerSupplierPayment(
  s: AppState,
  body: { billId: string; amount: number | string; method?: string; reference?: string; date?: string },
) {
  ensureCommercial(s);
  const bill = s.supplierBills!.find((item) => item.id === body.billId);
  if (!bill) throw new Error('Factura de proveedor no encontrada.');
  const amount = moneyOf(body.amount);
  if (amount <= 0) throw new Error('El pago debe ser mayor que cero.');
  if (amount > billBalance(s, bill.id) + 0.009) throw new Error('El pago supera el saldo con el proveedor.');
  const reference = body.reference?.trim();
  if (!reference) throw new Error('Indica la referencia del pago.');
  const n = nextSeq(s.supplierPayments!.map((payment) => payment.id));
  const payment = {
    id: `PAG-${String(n).padStart(4, '0')}`,
    supplierId: bill.supplierId,
    billId: bill.id,
    date: body.date || today(),
    amount,
    method: payMethod(body.method),
    reference,
  };
  s.supplierPayments!.unshift(payment);
  return payment;
}

export function savePriceList(s: AppState, body: Partial<PriceList> & { items?: PriceList['items'] }) {
  ensureCommercial(s);
  const name = body.name?.trim();
  const clientType = body.clientType?.trim();
  if (!name || !clientType) throw new Error('La lista necesita nombre y tipo de cliente.');
  const items = (body.items ?? [])
    .map((item) => ({
      productId: item.productId,
      price: moneyOf(item.price),
      minQty: Math.max(1, Math.round(Number(item.minQty) || 1)),
    }))
    .filter((item) => product(s, item.productId));
  if (!items.length) throw new Error('Agrega al menos un producto con precio.');
  const existing = body.id ? s.priceLists!.find((list) => list.id === body.id) : undefined;
  if (existing) {
    existing.name = name;
    existing.clientType = clientType;
    existing.items = items;
    return existing;
  }
  const n = nextSeq(s.priceLists!.map((list) => list.id));
  const list: PriceList = { id: `LP-${String(n).padStart(4, '0')}`, name, clientType, items };
  s.priceLists!.unshift(list);
  return list;
}

export function saveClientPrice(s: AppState, body: { clientId: string; productId: string; price: number | string }) {
  ensureCommercial(s);
  if (!client(s, body.clientId) || !product(s, body.productId)) {
    throw new Error('Selecciona un cliente y un producto.');
  }
  const price = moneyOf(body.price);
  const existing = s.clientPrices!.find(
    (item) => item.clientId === body.clientId && item.productId === body.productId,
  );
  if (existing) {
    existing.price = price;
    return existing;
  }
  const item = { clientId: body.clientId, productId: body.productId, price };
  s.clientPrices!.unshift(item);
  return item;
}

function lotOf(s: AppState, lotId: string) {
  const lot = s.lots.find((item) => item.id === lotId && item.qty > 0);
  if (!lot) throw new Error('Lote no encontrado.');
  return lot;
}

export function requestAdjustment(
  s: AppState,
  body: { lotId: string; qty: number | string; kind: string; reason: string },
) {
  ensureCommercial(s);
  const lot = lotOf(s, body.lotId);
  const qty = positiveInt(body.qty);
  if (qty > lot.qty) throw new Error('La cantidad supera el lote.');
  const kind = body.kind as AdjustmentKind;
  if (!ADJUST_KINDS.has(kind) || kind === 'Conteo') throw new Error('Elige merma, daño, vencimiento o cuarentena.');
  const reason = body.reason?.trim();
  if (!reason) throw new Error('Indica el motivo del ajuste.');
  const n = nextSeq(s.adjustments!.map((item) => item.id));
  const adjustment = {
    id: `AJ-${String(n).padStart(4, '0')}`,
    date: today(),
    kind,
    lotId: lot.id,
    productId: lot.productId,
    qty,
    direction: 'Salida' as const,
    reason,
    status: 'Pendiente' as const,
    warehouseId: lot.warehouseId ?? activeWarehouseId(s),
    requestedBy: actorName(s),
  };
  s.adjustments!.unshift(adjustment);
  return adjustment;
}

export function approveAdjustment(s: AppState, id: string) {
  ensureCommercial(s);
  const adjustment = s.adjustments!.find((item) => item.id === id);
  if (!adjustment || adjustment.status !== 'Pendiente') throw new Error('Ajuste no pendiente.');
  const lot = lotOf(s, adjustment.lotId);
  if (adjustment.qty > lot.qty) throw new Error('El lote ya no tiene esa cantidad.');
  if (adjustment.kind === 'Cuarentena') {
    lot.qty -= adjustment.qty;
    s.lots.push({
      ...lot,
      id: uid('lot'),
      qty: adjustment.qty,
      loc: QUARANTINE_LOC,
    });
    addEvent(s, 'Cuarentena', lot.productId, adjustment.qty, lot.loc, QUARANTINE_LOC, adjustment.id, lot.batch);
  } else {
    const from = lot.loc;
    lot.qty -= adjustment.qty;
    addEvent(s, adjustment.kind, lot.productId, adjustment.qty, from, 'Baja', adjustment.id, lot.batch);
  }
  s.lots = s.lots.filter((item) => item.qty > 0);
  adjustment.status = 'Aplicado';
  adjustment.approvedBy = actorName(s);
  return adjustment;
}

export function returnToSupplier(
  s: AppState,
  body: { lotId: string; qty: number | string; supplierId: string; purchaseId?: string; reason: string },
) {
  ensureCommercial(s);
  const lot = lotOf(s, body.lotId);
  const qty = positiveInt(body.qty);
  if (qty > lot.qty) throw new Error('La cantidad supera el lote.');
  if (!s.suppliers?.some((supplier) => supplier.id === body.supplierId)) throw new Error('Proveedor no encontrado.');
  const reason = body.reason?.trim();
  if (!reason) throw new Error('Indica el motivo de la devolución al proveedor.');
  const from = lot.loc;
  lot.qty -= qty;
  s.lots = s.lots.filter((item) => item.qty > 0);
  const n = nextSeq(s.supplierReturns!.map((item) => item.id));
  const doc = {
    id: `DPR-${String(n).padStart(4, '0')}`,
    supplierId: body.supplierId,
    purchaseId: body.purchaseId || undefined,
    date: today(),
    productId: lot.productId,
    lotId: lot.id,
    qty,
    batch: lot.batch,
    reason,
  };
  s.supplierReturns!.unshift(doc);
  addEvent(s, 'Devolución proveedor', lot.productId, qty, from, body.supplierId, doc.id, lot.batch);
  return doc;
}

export function openCycleCount(s: AppState) {
  ensureCommercial(s);
  const warehouseId = activeWarehouseId(s);
  const pending = s.cycleCounts!.find((count) => count.warehouseId === warehouseId && count.status === 'Borrador');
  if (pending) return pending;
  const lines = s.lots
    .filter((lot) => (lot.warehouseId ?? warehouseId) === warehouseId && lot.qty > 0 && isSellableLoc(lot.loc))
    .map((lot) => ({
      lotId: lot.id,
      productId: lot.productId,
      loc: lot.loc,
      batch: lot.batch,
      systemQty: lot.qty,
      countedQty: lot.qty,
    }));
  if (!lines.length) throw new Error('No hay lotes vendibles para contar en esta bodega.');
  const n = nextSeq(s.cycleCounts!.map((count) => count.id));
  const count: CycleCount = {
    id: `CNT-${String(n).padStart(4, '0')}`,
    date: today(),
    warehouseId,
    status: 'Borrador',
    lines,
  };
  s.cycleCounts!.unshift(count);
  return count;
}

export function applyCycleCount(
  s: AppState,
  body: { id: string; lines: Array<{ lotId: string; countedQty: number | string }> },
) {
  ensureCommercial(s);
  const count = s.cycleCounts!.find((item) => item.id === body.id);
  if (!count || count.status !== 'Borrador') throw new Error('Conteo no encontrado.');
  for (const line of count.lines) {
    const incoming = body.lines?.find((item) => item.lotId === line.lotId);
    const counted = incoming ? Number(incoming.countedQty) : line.systemQty;
    if (!Number.isInteger(counted) || counted < 0) throw new Error('La cantidad contada debe ser un entero mayor o igual a cero.');
    line.countedQty = counted;
    const delta = counted - line.systemQty;
    if (!delta) continue;
    const lot = s.lots.find((item) => item.id === line.lotId);
    if (!lot) throw new Error('Un lote del conteo ya no existe.');
    if (lot.qty + delta < 0) throw new Error('El conteo dejaría el lote en negativo.');
    lot.qty += delta;
    const n = nextSeq(s.adjustments!.map((item) => item.id));
    s.adjustments!.unshift({
      id: `AJ-${String(n).padStart(4, '0')}`,
      date: today(),
      kind: 'Conteo',
      lotId: lot.id,
      productId: lot.productId,
      qty: Math.abs(delta),
      direction: delta > 0 ? 'Entrada' : 'Salida',
      reason: `Conteo ${count.id}`,
      status: 'Aplicado',
      warehouseId: count.warehouseId,
    });
    addEvent(s, 'Conteo', lot.productId, Math.abs(delta), delta > 0 ? 'Conteo' : lot.loc, delta > 0 ? lot.loc : 'Conteo', count.id, lot.batch);
  }
  s.lots = s.lots.filter((lot) => lot.qty > 0);
  count.status = 'Aplicado';
  return count;
}

export function shipTransfer(
  s: AppState,
  body: { toWarehouseId: string; lines: Array<{ lotId: string; qty: number | string }> },
) {
  ensureCommercial(s);
  const fromWarehouseId = activeWarehouseId(s);
  if (!s.warehouses.some((warehouse) => warehouse.id === body.toWarehouseId)) {
    throw new Error('Bodega de destino no encontrada.');
  }
  if (body.toWarehouseId === fromWarehouseId) throw new Error('El destino debe ser otra bodega.');
  if (!body.lines?.length) throw new Error('El traslado necesita al menos un lote.');
  const lines = body.lines.map((line) => {
    const lot = lotOf(s, line.lotId);
    const qty = positiveInt(line.qty);
    if ((lot.warehouseId ?? fromWarehouseId) !== fromWarehouseId) throw new Error('El lote no está en la bodega activa.');
    if (!isSellableLoc(lot.loc)) throw new Error('No se traslada mercadería en cuarentena.');
    if (lot.onHold) throw new Error('El lote está en inspección. Libéralo antes de trasladarlo.');
    if (qty > lot.qty) throw new Error('La cantidad supera el lote.');
    return { lot, qty };
  });
  const n = nextSeq(s.transfers!.map((transfer) => transfer.id));
  const transfer: WarehouseTransfer = {
    id: `TR-${String(n).padStart(4, '0')}`,
    fromWarehouseId,
    toWarehouseId: body.toWarehouseId,
    date: today(),
    status: 'En tránsito',
    lines: lines.map(({ lot, qty }) => {
      const from = lot.loc;
      lot.qty -= qty;
      addEvent(s, 'Traslado bodega', lot.productId, qty, from, 'En tránsito', `TR-${String(n).padStart(4, '0')}`, lot.batch);
      return {
        productId: lot.productId,
        qty,
        batch: lot.batch,
        expiry: lot.expiry,
        lotId: lot.id,
        ...(lot.purchaseId ? { purchaseId: lot.purchaseId } : {}),
        ...(lot.receiptId ? { receiptId: lot.receiptId } : {}),
        ...(lot.receivedAt ? { receivedAt: lot.receivedAt } : {}),
      };
    }),
  };
  s.lots = s.lots.filter((lot) => lot.qty > 0);
  s.transfers!.unshift(transfer);
  return transfer;
}

function destinationBlock(
  s: AppState,
  warehouseId: string,
  productId: string,
  locId: string,
  qty: number,
  expiry: string,
) {
  const site = s.warehouses.find((warehouse) => warehouse.id === warehouseId);
  const geo = buildWarehouseGeometry(normalizeLayout(site?.layout ?? { racks: site?.racks }));
  const loc = geo.locations.find((item) => item.id === locId);
  if (!loc) return 'Ubicación no encontrada en la bodega de destino.';
  const here = s.lots.filter(
    (lot) => (lot.warehouseId ?? warehouseId) === warehouseId && lot.loc === locId && lot.qty > 0,
  );
  const used = here.reduce((n, lot) => n + lot.qty, 0);
  if (used + qty > loc.capacity) return `La cantidad supera la capacidad de esta ubicación (${loc.capacity} unidades).`;
  if (loc.volumeL) {
    const vol = (id: string) => product(s, id)?.volume ?? 0;
    const liters = here.reduce((n, lot) => n + lot.qty * vol(lot.productId), 0) + qty * vol(productId);
    if (liters > loc.volumeL + 1e-9) return `No cabe por volumen: la casilla admite ${loc.volumeL} L.`;
  }
  if (here.some((lot) => lot.productId !== productId)) {
    return 'Esta ubicación contiene otro producto. Selecciona una ubicación compatible.';
  }
  if (resolveBusinessRules(s.settings).separateExpiryLots !== false && here.length) {
    const expiries = new Set(here.map((lot) => lot.expiry));
    expiries.add(expiry);
    if (expiries.size > 1) return 'Esta ubicación tiene otro lote o caducidad. Usa una casilla libre.';
  }
  const item = product(s, productId);
  const hazard = item?.hazardClass ?? 'none';
  if (hazard !== 'none') {
    const inRack = s.lots.filter((lot) => {
      if ((lot.warehouseId ?? warehouseId) !== warehouseId || lot.qty <= 0) return false;
      const slot = geo.locations.find((place) => place.id === lot.loc);
      return slot?.rack === loc.rack;
    });
    for (const lot of inRack) {
      const other = product(s, lot.productId);
      if (!other || other.id === productId) continue;
      if (hazardsConflict(hazard, other.hazardClass)) {
        return `No se puede juntar ${HAZARD_LABEL[hazard]} con ${other.name} en el rack ${loc.rack}.`;
      }
    }
  }
  return null;
}

export function receiveTransfer(
  s: AppState,
  body: { id: string; lines: Array<{ lotId: string; loc: string }> },
) {
  ensureCommercial(s);
  const transfer = s.transfers!.find((item) => item.id === body.id);
  if (!transfer || transfer.status !== 'En tránsito') throw new Error('El traslado no está en tránsito.');
  for (const line of transfer.lines) {
    const place = body.lines?.find((item) => item.lotId === line.lotId);
    if (!place?.loc) throw new Error('Indica la ubicación de destino de cada lote.');
    const blocked = destinationBlock(s, transfer.toWarehouseId, line.productId, place.loc, line.qty, line.expiry);
    if (blocked) throw new Error(blocked);
  }
  for (const line of transfer.lines) {
    const place = body.lines.find((item) => item.lotId === line.lotId)!;
    s.lots.push({
      id: uid('lot'),
      productId: line.productId,
      qty: line.qty,
      loc: place.loc,
      batch: line.batch,
      expiry: line.expiry,
      warehouseId: transfer.toWarehouseId,
      ...(line.purchaseId ? { purchaseId: line.purchaseId } : {}),
      ...(line.receiptId ? { receiptId: line.receiptId } : {}),
      receivedAt: line.receivedAt ?? new Date().toISOString(),
    });
    addEvent(s, 'Recepción traslado', line.productId, line.qty, 'En tránsito', place.loc, transfer.id, line.batch);
  }
  transfer.status = 'Recibido';
  return transfer;
}

export type ReplenishmentLine = {
  productId: string;
  name: string;
  gap: number;
  packCode: string;
  packQty: number;
  unitsPerPack: number;
  unitPrice: number;
  /** mínimo propio, BOM o kit. */
  reason: string;
};

export function suggestReplenishment(s: AppState) {
  const needs = new Map<string, { gap: number; reasons: Set<string> }>();
  const addNeed = (productId: string, gap: number, reason: string) => {
    if (gap <= 0) return;
    const current = needs.get(productId) ?? { gap: 0, reasons: new Set<string>() };
    current.gap = Math.max(current.gap, gap);
    current.reasons.add(reason);
    needs.set(productId, current);
  };
  for (const item of s.products) {
    if (item.min <= 0) continue;
    const free = available(s, item.id);
    if (free < item.min) addNeed(item.id, Math.max(item.min * 2 - free, 1), 'mínimo propio');
  }
  for (const parent of s.products) {
    const components = parent.components ?? [];
    if (!components.length) continue;
    const short = Math.max(0, parent.min - available(s, parent.id));
    if (short <= 0) continue;
    for (const component of components) {
      const need = Math.ceil(component.qty * short);
      addNeed(component.productId, Math.max(0, need - available(s, component.productId)), 'BOM');
    }
  }
  for (const bundle of s.bundles ?? []) {
    for (const line of bundle.lines) {
      const have = available(s, line.productId);
      if (have < line.qty) addNeed(line.productId, line.qty - have, 'kit');
    }
  }
  const groups = new Map<string, { supplierId: string; supplierName: string; leadTimeDays: number; lines: ReplenishmentLine[] }>();
  for (const [productId, need] of needs) {
    const item = product(s, productId);
    if (!item?.supplierId) continue;
    const supplier = s.suppliers?.find((entry) => entry.id === item.supplierId);
    if (!supplier) continue;
    const packs = packsOf(item);
    const pack = [...packs].sort((a, b) => b.units - a.units).find((candidate) => candidate.units <= need.gap) ?? packs[0];
    const packQty = Math.max(1, Math.ceil(need.gap / pack.units));
    const group = groups.get(supplier.id) ?? {
      supplierId: supplier.id,
      supplierName: supplier.name,
      leadTimeDays: supplier.leadTimeDays || 7,
      lines: [],
    };
    group.lines.push({
      productId: item.id,
      name: item.name,
      gap: need.gap,
      packCode: pack.code,
      packQty,
      unitsPerPack: pack.units,
      unitPrice: roundMoney((item.avgCost ?? 0) * pack.units),
      reason: [...need.reasons].join(' · '),
    });
    groups.set(supplier.id, group);
  }
  return [...groups.values()];
}

export function createSuggestedPurchases(s: AppState) {
  ensureCommercial(s);
  const groups = suggestReplenishment(s);
  if (!groups.length) throw new Error('No hay productos bajo el mínimo con proveedor asignado.');
  const date = today();
  return groups.map((group) => {
    const expected = new Date(`${date}T12:00:00Z`);
    expected.setUTCDate(expected.getUTCDate() + group.leadTimeDays);
    return createPurchase(s, {
      supplierId: group.supplierId,
      expectedDate: expected.toISOString().slice(0, 10),
      notes: 'Reposición automática por stock bajo el mínimo.',
      lines: group.lines.map((line) => ({
        productId: line.productId,
        qty: line.packQty,
        packCode: line.packCode,
        unitPrice: line.unitPrice,
      })),
    });
  });
}

export function recallBatch(s: AppState, batch: string) {
  const key = batch.trim().toLowerCase();
  if (!key) throw new Error('Indica el lote a retirar.');
  const rows: Array<{
    orderId: string;
    clientId: string;
    clientName: string;
    productId: string;
    qty: number;
    date: string;
    status: string;
  }> = [];
  const seen = new Set<string>();
  for (const order of s.orders) {
    for (const pick of order.picks ?? []) {
      if ((pick.batch ?? '').trim().toLowerCase() !== key) continue;
      const id = `${order.id}:${pick.productId}:${pick.qty}`;
      if (seen.has(id)) continue;
      seen.add(id);
      rows.push({
        orderId: order.id,
        clientId: order.clientId,
        clientName: client(s, order.clientId)?.name ?? order.clientId,
        productId: pick.productId,
        qty: pick.qty,
        date: order.date,
        status: order.status,
      });
    }
  }
  const stock = s.lots
    .filter((lot) => lot.batch.trim().toLowerCase() === key && lot.qty > 0)
    .map((lot) => ({
      lotId: lot.id,
      productId: lot.productId,
      qty: lot.qty,
      loc: lot.loc,
      warehouseId: lot.warehouseId ?? activeWarehouseId(s),
      expiry: lot.expiry,
    }));
  return { batch: batch.trim(), clients: rows, stock };
}
