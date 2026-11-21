import test from 'node:test';
import assert from 'node:assert/strict';
import { seed } from '../src/domain/seed.js';
import { migrateState } from '../src/domain/state-migrate.js';
import { getWarehouseGeometry } from '../src/domain/warehouse-layout.js';
import {
  stock,
  available,
  isLotSellable,
  qtyAt,
  receive,
  move,
  createOrder,
  pickPlan,
  prepare,
  dispatch,
} from '../src/domain/inventory.service.js';
import { suggest } from '../src/domain/placement.service.js';
import { createPurchase } from '../src/domain/commerce.service.js';

test('El stock de ejemplo tiene una entrada y una orden recibida por lote', () => {
  const s = migrateState(seed());
  for (const lot of s.lots.filter((item) => item.qty > 0)) {
    const receipt = s.receipts.find((item) => item.lotId === lot.id);
    assert.ok(receipt, lot.id);
    assert.equal(receipt.productId, lot.productId);
    assert.equal(receipt.batch, lot.batch);
    assert.equal(lot.receiptId, receipt.id);
    assert.ok(receipt.qty >= lot.qty);
    const po = s.purchases.find((item) => item.id === receipt.purchaseId);
    assert.equal(po?.status, 'Recibida');
  }
});

test('Every seeded location respects capacity and one-product storage', () => {
  const s = seed();
  const { locations } = getWarehouseGeometry(s);
  for (const loc of locations) {
    assert.ok(qtyAt(s, loc.id) <= loc.capacity);
    assert.ok(new Set(s.lots.filter((l) => l.loc === loc.id).map((l) => l.productId)).size <= 1);
  }
  for (const p of s.products) assert.ok(available(s, p.id) >= 0);
});

test('Receiving and transferring preserve product totals', () => {
  const s = seed();
  const before = stock(s, 'P015');
  const loc = suggest(s, 'P015', 12).find((item) => qtyAt(s, item.id) === 0);
  assert.ok(loc);
  receive(s, {
    productId: 'P015',
    qty: 12,
    loc: loc.id,
    batch: 'TEST-001',
    expiry: '2099-12-31',
    supplier: 'Test',
    reason: 'Inventario inicial',
  });
  assert.equal(stock(s, 'P015'), before + 12);
  const lot = s.lots.find((l) => l.batch === 'TEST-001')!;
  const dest = suggest(s, 'P015', 7, lot.loc).find((item) => qtyAt(s, item.id) === 0)?.id;
  assert.ok(dest);
  move(s, { lotId: lot.id, qty: 7, to: dest });
  assert.equal(stock(s, 'P015'), before + 12);
});

test('Orders aggregate duplicate lines and reserve stock', () => {
  const s = seed();
  const before = available(s, 'P015');
  const o = createOrder(s, {
    clientId: 'CL001',
    lines: [
      { productId: 'P015', qty: 2 },
      { productId: 'P015', qty: 3 },
    ],
  });
  assert.equal(o.lines.length, 1);
  assert.equal(o.lines[0].qty, 5);
  assert.equal(available(s, 'P015'), before - 5);
});

test('Picking uses earliest expiry', () => {
  const s = seed();
  const o = createOrder(s, { clientId: 'CL001', lines: [{ productId: 'P001', qty: 2 }] });
  const plan = pickPlan(s, o);
  const first = plan.find((l) => l.productId === 'P001')!;
  const earliest = s.lots
    .filter((l) => l.productId === 'P001' && isLotSellable(s, l))
    .sort((a, b) => a.expiry.localeCompare(b.expiry))[0];
  assert.equal(first.id, earliest.id);
  prepare(s, o.id);
  assert.equal(o.status, 'Preparado');
});

test('FEFO saca el lote que vence antes aunque haya entrado después', () => {
  const s = seed();
  const lots = s.lots.filter((lot) => lot.productId === 'P001' && lot.qty > 0);
  assert.ok(lots.length >= 2);
  const [older, sooner] = lots;
  older.expiry = '2027-08-01';
  older.receivedAt = '2026-01-01';
  sooner.expiry = '2027-03-01';
  sooner.receivedAt = '2026-08-01';
  for (const lot of lots.slice(2)) lot.expiry = '2028-01-01';
  const order = createOrder(s, { clientId: 'CL001', lines: [{ productId: 'P001', qty: 1 }] });
  const plan = pickPlan(s, order);
  assert.equal(plan[0].batch, sooner.batch);
});

test('Papel sin fecha sigue siendo vendible y el desinfectante sin registro no', () => {
  const s = seed();
  const paper = s.lots.find((lot) => lot.productId === 'P012');
  assert.ok(paper);
  paper.expiry = '';
  assert.equal(isLotSellable(s, paper), true);
  const disinfectant = s.products.find((item) => item.id === 'P008');
  assert.ok(disinfectant?.requiresSanitary && disinfectant.sanitaryRegistration);
  disinfectant.sanitaryRegistration = '';
  assert.throws(() => createOrder(s, { clientId: 'CL002', lines: [{ productId: 'P008', qty: 1 }] }), /registro sanitario/);
});

test('El papel entra sin fecha contra una orden y queda vendible', () => {
  const s = seed();
  assert.equal(s.products.find((item) => item.id === 'P012')?.perishable, false);
  const po = createPurchase(s, { productId: 'P012', qty: 4 });
  const loc = suggest(s, 'P012', 4).find((item) => qtyAt(s, item.id) === 0);
  assert.ok(loc);
  receive(s, {
    productId: 'P012',
    qty: 4,
    loc: loc.id,
    batch: 'PAP-NEW',
    expiry: '',
    supplier: 'Papelera',
    purchaseId: po.id,
  });
  const lot = s.lots.find((item) => item.batch === 'PAP-NEW');
  assert.ok(lot);
  assert.equal(lot.purchaseId, po.id);
  assert.equal(lot.expiry, '');
  assert.equal(isLotSellable(s, lot), true);
});

test('No se despacha un pedido sin lote picado', () => {
  const s = seed();
  const order = s.orders.find((item) => item.id === 'PED-005');
  assert.ok(order);
  order.picks = [];
  assert.throws(() => dispatch(s, ['PED-005'], 'GBA-2041'), /lote de salida/);
});
