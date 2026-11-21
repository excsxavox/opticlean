import test from 'node:test';
import assert from 'node:assert/strict';
import { seed } from '../src/domain/seed.js';
import { available, createOrder, dispatch, prepare, receive, stock } from '../src/domain/inventory.service.js';
import { createPurchase } from '../src/domain/commerce.service.js';
import { createSupplier } from '../src/domain/suppliers.service.js';
import { suggest } from '../src/domain/placement.service.js';
import { buildWarehouseGeometry, normalizeLayout } from '../src/domain/warehouse-layout.js';
import {
  applyCycleCount,
  approveAdjustment,
  createSuggestedPurchases,
  issueCreditNote,
  issueGuide,
  issueInvoice,
  openCycleCount,
  recallBatch,
  receiveTransfer,
  registerCustomerPayment,
  registerSupplierBill,
  requestAdjustment,
  saveClientPrice,
  savePriceList,
  shipTransfer,
  suggestReplenishment,
} from '../src/domain/commercial.service.js';
import { invoiceBalance, overdueReceivable } from '../src/domain/ledger.js';
import { todayGuayaquil } from '../src/domain/inventory.service.js';

function sellableProduct(s: ReturnType<typeof seed>) {
  const item = s.products.find((product) => available(s, product.id) >= 2 && product.kind !== 'raw');
  if (!item) throw new Error('No hay producto con stock.');
  return item;
}

test('Una factura separa IVA, la nota reingresa a cuarentena y el abono baja el saldo', () => {
  const s = seed();
  const item = sellableProduct(s);
  const order = createOrder(s, { clientId: 'CL001', lines: [{ productId: item.id, qty: 1 }] });
  prepare(s, order.id);
  const invoice = issueInvoice(s, order.id);
  assert.equal(invoice.accessKey.length, 49);
  assert.equal(invoice.iva, Math.round(invoice.subtotal * 0.15 * 100) / 100);
  assert.ok(invoice.total > invoice.subtotal);
  const note = issueCreditNote(s, {
    invoiceId: invoice.id,
    reason: 'Producto no solicitado',
    lines: [{ productId: item.id, qty: 1, restock: true }],
  });
  assert.equal(note.total, invoice.total);
  assert.ok(s.lots.some((lot) => lot.loc === 'CUARENTENA' && lot.productId === item.id));
  assert.equal(invoiceBalance(s, invoice.id), 0);
  assert.throws(() => registerCustomerPayment(s, { invoiceId: invoice.id, amount: 1, reference: 'TRX' }), /saldo/);
});

test('La cartera vencida bloquea un pedido nuevo', () => {
  const s = seed();
  const item = sellableProduct(s);
  const order = createOrder(s, { clientId: 'CL001', lines: [{ productId: item.id, qty: 1 }] });
  prepare(s, order.id);
  const invoice = issueInvoice(s, order.id);
  invoice.date = '2020-01-01';
  assert.ok(overdueReceivable(s, 'CL001', todayGuayaquil()) > 0);
  assert.throws(
    () => createOrder(s, { clientId: 'CL001', lines: [{ productId: item.id, qty: 1 }] }),
    /cartera vencida/,
  );
});

test('El precio pactado y la lista reemplazan el precio de catálogo', () => {
  const s = seed();
  const item = sellableProduct(s);
  savePriceList(s, {
    name: 'Hoteles',
    clientType: 'Hotelería',
    items: [{ productId: item.id, price: 1.5, minQty: 1 }],
  });
  const listed = createOrder(s, { clientId: 'CL001', lines: [{ productId: item.id, qty: 1 }] });
  assert.equal(listed.lines[0].unitPrice, 1.5);
  saveClientPrice(s, { clientId: 'CL001', productId: item.id, price: 0.8 });
  const special = createOrder(s, { clientId: 'CL001', lines: [{ productId: item.id, qty: 1 }] });
  assert.equal(special.lines[0].unitPrice, 0.8);
});

test('La recepción contra orden actualiza el costo promedio', () => {
  const s = seed();
  const supplier = createSupplier(s, { name: 'Costo Test', taxId: '1790000000099' });
  const po = createPurchase(s, {
    supplierId: supplier.id,
    lines: [{ productId: 'P015', qty: 1, packCode: 'unidad', unitPrice: 6 }],
  });
  const loc = suggest(s, 'P015', 1).find((item) => !s.lots.some((lot) => lot.loc === item.id && lot.qty > 0));
  assert.ok(loc);
  receive(s, {
    productId: 'P015',
    qty: 1,
    loc: loc.id,
    batch: 'COSTO-1',
    expiry: '2099-01-01',
    supplier: supplier.name,
    purchaseId: po.id,
    packCode: 'unidad',
    packQty: 1,
  });
  assert.equal(s.products.find((product) => product.id === 'P015')?.avgCost, 6);
  const bill = registerSupplierBill(s, { purchaseId: po.id, number: '001-001-9', total: 6 });
  assert.equal(bill.total, 6);
});

test('Un registro sanitario vencido impide vender', () => {
  const s = seed();
  const item = sellableProduct(s);
  item.sanitaryRegistration = 'ARCSA-1';
  item.sanitaryExpires = '2020-01-01';
  assert.throws(
    () => createOrder(s, { clientId: 'CL001', lines: [{ productId: item.id, qty: 1 }] }),
    /registro sanitario/,
  );
});

test('La merma no baja el stock hasta aprobarla y el conteo sí ajusta', () => {
  const s = seed();
  const lot = s.lots.find((item) => item.qty > 2 && item.loc !== 'CUARENTENA');
  assert.ok(lot);
  const before = lot.qty;
  const adjustment = requestAdjustment(s, { lotId: lot.id, qty: 1, kind: 'Merma', reason: 'Envase roto' });
  assert.equal(stock(s, lot.productId), stock(s, lot.productId));
  assert.equal(s.lots.find((item) => item.id === lot.id)?.qty, before);
  approveAdjustment(s, adjustment.id);
  assert.equal(s.lots.find((item) => item.id === lot.id)?.qty, before - 1);
  const count = openCycleCount(s);
  const line = count.lines.find((item) => item.lotId === lot.id);
  assert.ok(line);
  applyCycleCount(s, { id: count.id, lines: [{ lotId: lot.id, countedQty: line.systemQty - 1 }] });
  assert.equal(count.status, 'Aplicado');
});

test('El traslado sale de origen y entra en destino con guía', () => {
  const s = seed();
  const lot = s.lots.find((item) => item.qty > 0 && (item.warehouseId ?? 'WH-QT-01') === 'WH-QT-01' && item.loc !== 'CUARENTENA');
  assert.ok(lot);
  const transfer = shipTransfer(s, { toWarehouseId: 'WH-GYQ-01', lines: [{ lotId: lot.id, qty: 1 }] });
  assert.equal(transfer.status, 'En tránsito');
  const guide = issueGuide(s, { transferId: transfer.id });
  assert.equal(guide.kind, 'Traslado');
  const dest = s.warehouses.find((warehouse) => warehouse.id === 'WH-GYQ-01');
  const geo = buildWarehouseGeometry(normalizeLayout(dest!.layout));
  const free = geo.locations.find((loc) => !s.lots.some((item) => item.warehouseId === 'WH-GYQ-01' && item.loc === loc.id && item.qty > 0));
  assert.ok(free);
  receiveTransfer(s, { id: transfer.id, lines: [{ lotId: lot.id, loc: free.id }] });
  assert.equal(transfer.status, 'Recibido');
  assert.ok(s.lots.some((item) => item.warehouseId === 'WH-GYQ-01' && item.loc === free.id && item.batch === lot.batch));
});

test('La reposición agrupa por proveedor y el retiro encuentra al cliente', () => {
  const s = seed();
  const item = s.products.find((product) => product.min > 0 && available(s, product.id) < product.min && product.supplierId);
  if (item) {
    const groups = suggestReplenishment(s);
    assert.ok(groups.some((group) => group.lines.some((line) => line.productId === item.id)));
  }
  const supplier = createSupplier(s, { name: 'Reposición', taxId: '1790000000088', leadTimeDays: 4 });
  const target = s.products.find((product) => product.min > available(s, product.id)) ?? s.products[0];
  target.supplierId = supplier.id;
  target.min = available(s, target.id) + 5;
  const purchases = createSuggestedPurchases(s);
  assert.ok(purchases.some((purchase) => purchase.supplierId === supplier.id));

  const parent = s.products.find((item) => item.id === 'P018');
  const component = parent?.components?.find((item) => item.productId === 'MP-CLORO');
  const child = s.products.find((item) => item.id === 'MP-CLORO');
  assert.ok(parent && component && child);
  child.supplierId = supplier.id;
  child.min = 0;
  const parentAvail = available(s, parent.id);
  const childAvail = available(s, child.id);
  const short = Math.max(2, Math.ceil((childAvail + 1) / component.qty));
  parent.min = parentAvail + short;
  const bomGap = component.qty * short - childAvail;
  const suggested = suggestReplenishment(s);
  const bomLine = suggested.flatMap((group) => group.lines).find((line) => line.productId === child.id && line.reason.includes('BOM'));
  assert.ok(bomLine);
  assert.ok(bomLine.packQty * bomLine.unitsPerPack >= bomGap);

  const sellable = sellableProduct(s);
  const order = createOrder(s, { clientId: 'CL002', lines: [{ productId: sellable.id, qty: 1 }] });
  prepare(s, order.id);
  const batch = order.picks?.[0]?.batch ?? '';
  const recall = recallBatch(s, batch);
  assert.ok(recall.clients.some((row) => row.orderId === order.id && row.clientId === 'CL002'));
});

test('La factura copia el lote picado y el despacho emite una sola guía', () => {
  const s = seed();
  const item = sellableProduct(s);
  const order = createOrder(s, { clientId: 'CL001', lines: [{ productId: item.id, qty: 1 }] });
  prepare(s, order.id);
  const picks = order.picks ?? [];
  order.picks = [];
  assert.throws(() => issueInvoice(s, order.id), /lote de salida/);
  order.picks = picks;
  const invoice = issueInvoice(s, order.id);
  assert.equal(invoice.lines[0].batch, order.picks?.[0]?.batch);
  assert.ok(invoice.lines[0].batch);
  dispatch(s, [order.id], 'GBA-2041');
  const guides = (s.guides ?? []).filter((guide) => guide.orderId === order.id && guide.status === 'Emitida');
  assert.equal(guides.length, 1);
  assert.equal(guides[0].lines[0].batch, order.picks?.[0]?.batch);
  const again = issueGuide(s, { orderId: order.id });
  assert.equal(again.id, guides[0].id);
  assert.equal((s.guides ?? []).filter((guide) => guide.orderId === order.id).length, 1);
});
