import test from 'node:test';
import assert from 'node:assert/strict';
import { seed } from '../src/domain/seed.js';
import { migrateState } from '../src/domain/state-migrate.js';
import { confirmDelivery, createOrder, dispatch, prepare } from '../src/domain/inventory.service.js';
import { createSupplier } from '../src/domain/suppliers.service.js';
import {
  approvePlan,
  createQuote,
  discardPlan,
  loadPreview,
  loseQuote,
  planView,
  readLabel,
  saveOffering,
  skipAndReoptimize,
  tripCost,
  winQuote,
} from '../src/domain/outbound.service.js';
import { renderReport } from '../src/domain/report-file.js';
import { createParcel } from '../src/domain/packing.service.js';
import { packAll } from './helpers/pack.js';

test('La cotización se gana como pedido del mismo canal y no se vuelve a ganar', () => {
  const s = seed();
  const quote = createQuote(s, {
    clientId: 'CL001',
    validUntil: '2099-01-01',
    channel: 'portal',
    lines: [{ productId: 'P001', qty: 1, unitPrice: 2 }],
  });
  const won = winQuote(s, quote.id);
  assert.equal(won.order.channel, 'portal');
  assert.equal(won.order.quoteId, quote.id);
  assert.throws(() => winQuote(s, quote.id), /abierta/);
});

test('Una cotización vencida no se convierte en pedido', () => {
  const s = seed();
  const quote = createQuote(s, {
    clientId: 'CL001',
    validUntil: '2099-01-01',
    lines: [{ productId: 'P001', qty: 1, unitPrice: 2 }],
  });
  quote.validUntil = '2000-01-01';
  assert.throws(() => winQuote(s, quote.id), /vencida/);
  loseQuote(s, quote.id);
  assert.equal(quote.status, 'Perdida');
});

test('El empaque exige un pedido preparado y la carga avisa si no llega al 80%', () => {
  const s = seed();
  const order = createOrder(s, { clientId: 'CL001', lines: [{ productId: 'P001', qty: 1 }] });
  assert.throws(() => createParcel(s, { orderId: order.id }), /preparado/);
  prepare(s, order.id);
  packAll(s, order.id);
  const preview = loadPreview(s, 'GBA-2041', [order.id]);
  assert.equal(preview.underMin, true);
  assert.deepEqual(preview.loadSequence, [order.id]);
});

test('La entrega en ruta exige el código que se emitió al despachar', () => {
  const s = seed();
  const order = createOrder(s, { clientId: 'CL001', lines: [{ productId: 'P001', qty: 1 }] });
  prepare(s, order.id);
  dispatch(s, [order.id], 'GBA-2041');
  assert.throws(() => confirmDelivery(s, order.id, 'María', undefined, '000000'), /no coincide/);
  confirmDelivery(s, order.id, 'María', undefined, order.deliveryCode);
  assert.equal(order.status, 'Entregado');
});

test('Saltar una parada la saca de la ruta y reordena el resto', () => {
  const s = seed();
  const first = createOrder(s, { clientId: 'CL001', lines: [{ productId: 'P001', qty: 1 }] });
  const second = createOrder(s, { clientId: 'CL002', lines: [{ productId: 'P001', qty: 1 }] });
  prepare(s, first.id);
  prepare(s, second.id);
  dispatch(s, [first.id, second.id], 'GBA-2041');
  const left = skipAndReoptimize(s, first.id);
  assert.equal(first.skipped, true);
  assert.equal(first.status, 'Incidencia');
  assert.ok(left.includes(second.id));
  assert.ok(!left.includes(first.id));
  assert.equal(typeof second.stopOrder, 'number');
});

test('El catálogo del proveedor no repite el producto y la etiqueta lee presentaciones', () => {
  const s = migrateState(seed());
  const supplier = s.suppliers?.[0] ?? createSupplier(s, { name: 'Etiquetas', taxId: '1790000099001' });
  saveOffering(s, { supplierId: supplier.id, productId: 'P001', supplierSku: 'PR-1', unitCost: 1.5, minQty: 6 });
  assert.throws(
    () => saveOffering(s, { supplierId: supplier.id, productId: 'P001', supplierSku: 'PR-2', unitCost: 1, minQty: 1 }),
    /catálogo/,
  );
  const label = readLabel('Cloro 5 L\nPresentación: Galón\nAdvertencia: inflamable');
  assert.equal(label.hazardous, true);
  assert.ok(label.presentations.includes('Galón'));
  assert.ok(label.attributes.some((attribute) => attribute.name === 'Presentación'));
});

test('El plan se puede descartar y el informe sale en Excel y PDF', async () => {
  const s = migrateState(seed());
  const view = planView(s);
  assert.ok(Array.isArray(view.forecast));
  if (view.actions[0]) {
    discardPlan(s, view.actions[0].id, 'No esta semana');
    assert.throws(() => approvePlan(s, view.actions[0].id), /decidió|no aplica|abierta/);
  }
  const vehicle = s.vehicles!.find((item) => item.plate === 'GBA-2041')!;
  const cost = tripCost(vehicle, 40);
  assert.ok(cost.fuel > 0);
  const xlsx = await renderReport(s, 'traceability', 'xlsx');
  const pdf = await renderReport(s, 'diagnostics', 'pdf');
  assert.ok(xlsx.buffer.length > 100);
  assert.equal(pdf.buffer.subarray(0, 5).toString(), '%PDF-');
});
