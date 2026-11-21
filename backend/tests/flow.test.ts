import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { seed } from '../src/domain/seed.js';
import { migrateState } from '../src/domain/state-migrate.js';
import type { AppState } from '../src/domain/types.js';
import {
  available,
  confirmDelivery,
  createOrder,
  dispatch,
  pickPlan,
  prepare,
  receive,
  rejectLot,
  releaseLot,
  sellableStock,
  stock,
} from '../src/domain/inventory.service.js';
import {
  cancelPurchase,
  closePurchase,
  createBackorderPurchases,
  createPurchase,
  promoteWaitingOrders,
  receivePurchase,
} from '../src/domain/commerce.service.js';
import {
  issueInvoice,
  registerCustomerPayment,
  registerSupplierBill,
} from '../src/domain/commercial.service.js';
import { suggest } from '../src/domain/placement.service.js';
import { QUARANTINE_LOC } from '../src/domain/ledger.js';
import { runAs } from '../src/domain/request-context.js';
import { JsonStateRepository } from '../src/infrastructure/persistence/JsonStateRepository.js';
import { stateForUser } from '../src/infrastructure/http/state-view.js';

const P = 'P015';

function fresh(): AppState {
  const s = migrateState(seed());
  s.lots = s.lots.filter((lot) => lot.productId !== P);
  return s;
}

function emptyLoc(s: AppState, qty: number, skip: string[] = []) {
  const loc = suggest(s, P, qty).find((l) => l.isEmpty && !skip.includes(l.id));
  assert.ok(loc, 'debe haber una casilla libre');
  return loc.id;
}

const addDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

test('Flujo completo: OC → recepción → pedido → picking FEFO → factura → entrega → cobro', () => {
  const s = fresh();
  const supplierId = s.products.find((p) => p.id === P)!.supplierId!;
  assert.ok(supplierId, 'el producto tiene proveedor');

  const po = createPurchase(s, {
    supplierId,
    lines: [{ productId: P, qty: 30, packCode: 'unidad', unitPrice: 4 }],
  });
  const locA = emptyLoc(s, 10);
  const locB = emptyLoc(s, 20, [locA]);
  // Mismo vencimiento en dos recepciones: debe salir primero la que entró antes.
  receivePurchase(s, po.id, {
    lines: [{ productId: P, qty: 10, loc: locA, batch: 'L-OLD', expiry: addDays(200) }],
  });
  const first = s.lots.find((l) => l.batch === 'L-OLD')!;
  first.receivedAt = '2026-01-01T00:00:00.000Z';
  receivePurchase(s, po.id, {
    lines: [{ productId: P, qty: 20, loc: locB, batch: 'L-NEW', expiry: addDays(200) }],
  });
  assert.equal(po.status, 'Recibida');

  // Origen guardado en lote y recepción.
  const lot = s.lots.find((l) => l.batch === 'L-NEW')!;
  assert.equal(lot.purchaseId, po.id);
  assert.ok(lot.receiptId && lot.receivedAt);
  const receipt = s.receipts.find((r) => r.id === lot.receiptId)!;
  assert.equal(receipt.purchaseId, po.id);
  assert.equal(receipt.expiry, addDays(200));
  assert.equal(receipt.lotId, lot.id);

  const order = createOrder(s, { clientId: 'CL001', lines: [{ productId: P, qty: 12 }] });
  assert.equal(order.status, 'Por preparar');
  const plan = pickPlan(s, order);
  const fromOld = plan.find((p) => p.batch === 'L-OLD');
  assert.equal(fromOld?.qty, 10, 'FEFO con desempate por fecha de ingreso');
  assert.equal(plan.find((p) => p.batch === 'L-NEW')?.qty, 2);

  prepare(s, order.id);
  assert.ok(order.picks?.every((p) => p.purchaseId === po.id), 'el picking conserva la OC de origen');

  const invoice = issueInvoice(s, order.id);
  assert.equal(invoice.lines[0].ivaRate, 0.15);
  assert.ok((invoice.lines[0].unitCost ?? 0) > 0, 'la factura guarda el costo para el margen');

  dispatch(s, [order.id], 'GBA-2041');
  assert.match(order.deliveryCode ?? '', /^\d{6}$/);
  confirmDelivery(s, order.id, 'María Torres', undefined, order.deliveryCode);
  registerCustomerPayment(s, { invoiceId: invoice.id, amount: invoice.total, method: 'Transferencia', reference: 'T-1' });
  assert.equal(order.status, 'Entregado');

  // Factura del proveedor con IVA sobre lo recibido (30 × 4 × 1.15 = 138).
  const bill = registerSupplierBill(s, { purchaseId: po.id, number: '001-001-123', total: 138 });
  assert.equal(bill.total, 138);
});

test('Stock vencido o bajo la vida útil mínima no cuenta como disponible', () => {
  const s = fresh();
  const loc = emptyLoc(s, 5);
  s.lots.push({ id: 'lot-exp', productId: P, loc, qty: 5, batch: 'VENCIDO', expiry: '2020-01-01', warehouseId: s.settings.activeWarehouseId });
  assert.equal(stock(s, P), 5);
  assert.equal(sellableStock(s, P), 0);
  assert.equal(available(s, P), 0);
  assert.throws(() => createOrder(s, { clientId: 'CL001', lines: [{ productId: P, qty: 1 }] }), /Stock insuficiente/);
});

test('Pedido con faltante: queda esperando, genera OC enlazada y se libera al recibir', () => {
  const s = fresh();
  const order = createOrder(s, { clientId: 'CL001', lines: [{ productId: P, qty: 6 }], backorder: true });
  assert.equal(order.status, 'Esperando stock');
  assert.deepEqual(order.shortages, [{ productId: P, qty: 6 }]);
  const [po] = createBackorderPurchases(s, order);
  assert.ok(po);
  assert.deepEqual(po.orderIds, [order.id]);
  assert.deepEqual(order.purchaseIds, [po.id]);
  assert.deepEqual(promoteWaitingOrders(s), []);

  const loc = emptyLoc(s, 6);
  receivePurchase(s, po.id, { lines: [{ productId: P, qty: 6, loc, batch: 'BO-1', expiry: addDays(300) }] });
  assert.deepEqual(promoteWaitingOrders(s), [order.id]);
  assert.equal(order.status, 'Por preparar');
});

test('Recepción a inspección: no se vende hasta liberar; el rechazo va a cuarentena', () => {
  const s = fresh();
  const loc = emptyLoc(s, 4);
  receive(s, { productId: P, qty: 4, loc, batch: 'INSP', expiry: addDays(100), supplier: 'Q', reason: 'Muestra', inspect: true });
  const lot = s.lots.find((l) => l.batch === 'INSP')!;
  assert.equal(lot.onHold, true);
  assert.equal(available(s, P), 0);
  releaseLot(s, lot.id);
  assert.equal(available(s, P), 4);
  assert.equal(s.receipts.find((r) => r.lotId === lot.id)?.inspection, 'Liberado');

  const loc2 = emptyLoc(s, 3, [loc]);
  receive(s, { productId: P, qty: 3, loc: loc2, batch: 'INSP2', expiry: addDays(100), supplier: 'Q', reason: 'Muestra', inspect: true });
  const bad = s.lots.find((l) => l.batch === 'INSP2')!;
  rejectLot(s, bad.id, 'Envase roto');
  assert.equal(bad.loc, QUARANTINE_LOC);
  assert.equal(available(s, P), 4);
});

test('Sin orden de compra la recepción exige un motivo válido', () => {
  const s = fresh();
  const loc = emptyLoc(s, 1);
  const base = { productId: P, qty: 1, loc, batch: 'X', expiry: addDays(50), supplier: 'Q' };
  assert.throws(() => receive(s, base), /motivo/);
  assert.throws(() => receive(s, { ...base, reason: 'Porque sí' }), /Motivo no válido/);
  receive(s, { ...base, reason: 'Donación' });
  assert.equal(s.receipts[0].reason, 'Donación');
});

test('Una OC parcial se cierra con faltante; no se cancela', () => {
  const s = fresh();
  const po = createPurchase(s, { lines: [{ productId: P, qty: 10, packCode: 'unidad', unitPrice: 4 }] });
  const loc = emptyLoc(s, 4);
  receive(s, { productId: P, qty: 4, loc, batch: 'PC', expiry: addDays(90), supplier: 'Q', purchaseId: po.id });
  assert.equal(po.status, 'Parcial');
  assert.throws(() => cancelPurchase(s, po.id), /Ciérrala/);
  assert.throws(() => closePurchase(s, po.id, ''), /por qué/);
  closePurchase(s, po.id, 'Proveedor sin stock');
  assert.equal(po.status, 'Cerrada');
  assert.equal(po.closeReason, 'Proveedor sin stock');
});

test('Si la bodega define volumen por casilla, no se recibe lo que no cabe', () => {
  const s = fresh();
  const wh = s.warehouses.find((w) => w.id === s.settings.activeWarehouseId)!;
  wh.layout = { ...wh.layout, cellVolumeL: 20 };
  const loc = emptyLoc(s, 3);
  // Limpiavidrios ocupa 6 L: 3 unidades (18 L) caben, 4 (24 L) no.
  assert.throws(
    () => receive(s, { productId: P, qty: 4, loc, batch: 'V', expiry: addDays(90), supplier: 'Q', reason: 'Muestra' }),
    /volumen/,
  );
  receive(s, { productId: P, qty: 3, loc, batch: 'V', expiry: addDays(90), supplier: 'Q', reason: 'Muestra' });
});

test('El historial firma cada movimiento con el usuario de la petición', () => {
  const s = fresh();
  const loc = emptyLoc(s, 1);
  runAs({ id: 'U-9', name: 'Ana Bodega', role: 'ops', companyId: 'co-innovamf' }, () =>
    receive(s, { productId: P, qty: 1, loc, batch: 'AUD', expiry: addDays(30), supplier: 'Q', reason: 'Muestra' }),
  );
  assert.equal(s.events[0].by, 'Ana Bodega');
  assert.equal(s.receipts[0].by, 'Ana Bodega');
});

test('El chofer solo ve los pedidos de su camión, sin precios de compra ni cartera', () => {
  const s = fresh();
  const mine = s.orders.find((o) => o.status === 'En ruta');
  if (mine) mine.vehicle = 'GBA-2041';
  const view = stateForUser(s, { id: 'U-DRIVER', email: 'd@x', name: 'Chofer', role: 'driver', companyId: 'co-innovamf', truckPlate: 'GBA-2041' });
  assert.ok(view.orders.every((o) => o.vehicle === 'GBA-2041' || o.stagedPlate === 'GBA-2041'));
  assert.equal(view.lots.length, 0);
  assert.equal(view.purchases.length, 0);
  assert.ok(view.clients.every((c) => c.creditLimit === undefined));
  const ops = stateForUser(s, { id: 'U-OPS', email: 'o@x', name: 'Bodega', role: 'ops', companyId: 'co-innovamf' });
  assert.equal(ops.supplierBills?.length, 0);
});

test('Repositorio: cada empresa tiene sus datos, sin pérdidas con escrituras simultáneas y con respaldo', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'opticlean-'));
  try {
    const repo = new JsonStateRepository(dir);
    const asCo = <T,>(companyId: string, fn: () => Promise<T>) =>
      runAs({ id: 'U', name: 'U', role: 'admin', companyId }, fn);

    const demo = await asCo('co-innovamf', () => repo.load());
    const other = await asCo('co-otra', () => repo.load());
    assert.ok(demo.products.length > 0, 'la empresa por defecto conserva sus datos');
    assert.equal(other.products.length, 0, 'una empresa nueva empieza vacía');
    assert.equal(other.clients.length, 0);
    assert.equal(other.demo, false);

    // 25 escrituras concurrentes: ninguna se pierde.
    await asCo('co-otra', () =>
      Promise.all(
        Array.from({ length: 25 }, (_, i) =>
          repo.transaction((s) => {
            s.clients.push({ id: `C${i}`, name: `C${i}`, contact: '', address: '', email: '', type: 'X' });
          }),
        ),
      ),
    );
    const after = await asCo('co-otra', () => repo.load());
    assert.equal(after.clients.length, 25);
    const stillDemo = await asCo('co-innovamf', () => repo.load());
    assert.ok(!stillDemo.clients.some((c) => c.id === 'C0'), 'no se mezclan empresas');

    const backups = await readdir(path.join(dir, 'backups'));
    assert.ok(backups.some((f) => f.startsWith('state-co-otra-')), 'respaldo diario');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
