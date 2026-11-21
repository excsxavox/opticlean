import test from 'node:test';
import assert from 'node:assert/strict';
import { seed } from '../src/domain/seed.js';
import { available, createOrder, prepare, receive } from '../src/domain/inventory.service.js';
import { suggest } from '../src/domain/placement.service.js';
import { createPurchase } from '../src/domain/commerce.service.js';
import { createSupplier } from '../src/domain/suppliers.service.js';
import { assembleBundle } from '../src/domain/kits.service.js';
import { ensureBundles } from '../src/domain/bundles.service.js';
import { previewCsv, commitImport } from '../src/domain/import-docs.service.js';
import { migrateState } from '../src/domain/state-migrate.js';

test('A purchase order converts boxes into stock units', () => {
  const s = seed();
  const supplier = createSupplier(s, { name: 'Químicos Test', taxId: '1790000000001', leadTimeDays: 5 });
  const po = createPurchase(s, {
    supplierId: supplier.id,
    lines: [{ productId: 'P015', qty: 2, packCode: 'caja', unitPrice: 4 }],
  });
  assert.equal(po.qty, 24);
  assert.equal(po.lines?.[0].unitsPerPack, 12);
  const loc = suggest(s, 'P015', 24).find((item) => !s.lots.some((lot) => lot.loc === item.id && lot.qty > 0))?.id;
  assert.ok(loc);
  receive(s, {
    productId: 'P015',
    packCode: 'caja',
    packQty: 1,
    qty: 1,
    loc,
    batch: 'CJ-1',
    expiry: '2099-06-01',
    supplier: supplier.name,
    purchaseId: po.id,
  });
  assert.equal(po.status, 'Parcial');
  assert.equal(po.received, 12);
});

test('Incompatible chemicals cannot share a rack', () => {
  const s = migrateState(seed());
  const cloro = s.products.find((p) => p.id === 'P018')!;
  const base = s.products.find((p) => p.id === 'P005')!;
  assert.equal(cloro.hazardClass, 'chlorinated');
  assert.equal(base.hazardClass, 'base');
  const cloroLot = s.lots.find((l) => l.productId === 'P018' && l.qty > 0);
  if (!cloroLot) return;
  const rack = cloroLot.loc.split('-')[0];
  const dest = suggest(s, 'P001', 1).find((loc) => loc.rack === rack);
  const target = dest?.id ?? s.lots.find((l) => l.loc.startsWith(`${rack}-`) && l.productId !== 'P018')?.loc;
  if (!target) return;
  assert.throws(
    () => receive(s, { productId: 'P005', qty: 1, loc: target, batch: 'B', expiry: '2099-01-01', supplier: 'Q', reason: 'Inventario inicial' }),
    /No se puede juntar/,
  );
});

test('Different expiries cannot share a location', () => {
  const s = migrateState(seed());
  const loc = suggest(s, 'P015', 2).find((item) => !s.lots.some((lot) => lot.loc === item.id && lot.qty > 0))?.id;
  assert.ok(loc);
  receive(s, { productId: 'P015', qty: 1, loc, batch: 'A', expiry: '2099-01-01', supplier: 'Q', reason: 'Inventario inicial' });
  assert.throws(
    () => receive(s, { productId: 'P015', qty: 1, loc, batch: 'B', expiry: '2099-08-01', supplier: 'Q', reason: 'Inventario inicial' }),
    /caducidad/,
  );
});

test('Orders are blocked when they exceed the credit limit', () => {
  const s = seed();
  const buyer = s.clients.find((c) => c.id === 'CL004')!;
  buyer.creditLimit = 1;
  assert.throws(
    () => createOrder(s, { clientId: 'CL004', lines: [{ productId: 'P001', qty: 2 }] }),
    /cupo de crédito/,
  );
});

test('A kit reserves its components and can be assembled into stock', () => {
  const s = seed();
  ensureBundles(s);
  const before = available(s, 'P001');
  const order = createOrder(s, { clientId: 'CL001', kits: [{ bundleId: 'KIT01', qty: 1 }] });
  assert.equal(order.lines.length, 0);
  assert.equal(available(s, 'P001'), before - 4);
  prepare(s, order.id);
  assert.equal(order.status, 'Preparado');
  assert.ok(order.picks?.some((p) => p.productId === 'P001'));

  const s2 = seed();
  ensureBundles(s2);
  const assembled = assembleBundle(s2, { bundleId: 'KIT01', qty: 1, batch: 'KIT-1', expiry: '2099-12-01' });
  assert.equal(assembled.productId, 'KIT01');
  assert.ok(s2.lots.some((l) => l.productId === 'KIT01' && l.qty === 1));
});

test('CSV purchase import previews rows and does not invent an expiry', () => {
  const s = seed();
  const csv = 'codigo,descripcion,cantidad,empaque,precio\nP018,Cloro 5 L,2,caja,4.5\n';
  const preview = previewCsv(s, csv, 'purchase');
  assert.equal(preview.rows[0].status, 'matched');
  assert.equal(preview.rows[0].packCode, 'caja');
  assert.equal(preview.rows[0].expiry, '');
  assert.match(preview.warnings[0], /No se inventó/);
  const committed = commitImport(s, {
    kind: 'purchase',
    partyName: 'Química Andina',
    partyTaxId: '1790000001001',
    docNumber: 'OC-CSV-1',
    rows: preview.rows,
  });
  assert.ok(committed.purchaseId.startsWith('OC-'));
  const po = s.purchases.find((p) => p.id === committed.purchaseId)!;
  assert.equal(po.lines?.[0].expiry, undefined);
  assert.equal(po.qty, 24);
});
