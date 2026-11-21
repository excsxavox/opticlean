import test from 'node:test';
import assert from 'node:assert/strict';
import { seed } from '../src/domain/seed.js';
import { available, createOrder, deleteProduct, dispatch, prepare, receive, stock, upsertProduct } from '../src/domain/inventory.service.js';
import { suggest } from '../src/domain/placement.service.js';
import {
  cancelOrder,
  cancelPurchase,
  createClient,
  createPurchase,
  deleteClient,
  stageOrders,
  unstageOrders,
  updateClient,
} from '../src/domain/commerce.service.js';
import { createSupplier } from '../src/domain/suppliers.service.js';
import { deleteBundle, saveBundle } from '../src/domain/bundles.service.js';
import { deleteVehicle, upsertVehicle } from '../src/domain/fleet.service.js';

test('Cancelling a pending order releases its reservation', () => {
  const s = seed();
  const before = available(s, 'P001');
  const o = createOrder(s, { clientId: 'CL001', lines: [{ productId: 'P001', qty: 3 }] });
  assert.equal(available(s, 'P001'), before - 3);
  cancelOrder(s, o.id, 'Cliente desiste');
  assert.equal(o.status, 'Cancelado');
  assert.equal(available(s, 'P001'), before);
});

test('Cancelling a prepared order returns picked units to the warehouse', () => {
  const s = seed();
  const o = createOrder(s, { clientId: 'CL001', lines: [{ productId: 'P001', qty: 4 }] });
  const before = stock(s, 'P001');
  prepare(s, o.id);
  assert.equal(stock(s, 'P001'), before - 4);
  cancelOrder(s, o.id, 'Error de digitación');
  assert.equal(stock(s, 'P001'), before);
  assert.ok(s.events.some((e) => e.type === 'Devolución' && e.ref === o.id));
});

test('Orders on route cannot be cancelled and a reason is mandatory', () => {
  const s = seed();
  const onRoute = s.orders.find((o) => o.status === 'En ruta')!;
  assert.throws(() => cancelOrder(s, onRoute.id, 'x'), /Solo se pueden cancelar/);
  const o = createOrder(s, { clientId: 'CL001', lines: [{ productId: 'P001', qty: 1 }] });
  assert.throws(() => cancelOrder(s, o.id, '  '), /motivo/);
});

test('Dispatch uses the registered vehicle capacity', () => {
  const s = seed();
  const ready = s.orders.filter((o) => o.status === 'Preparado').map((o) => o.id);
  assert.throws(() => dispatch(s, ready, 'XXX-0000'), /no está registrado/);
  const small = upsertVehicle(s, {
    plate: 'TINY-001', label: 'Moto', city: 'Quito', driver: 'Test', maxKg: 1, maxM3: 1, costPerKm: 1,
  });
  assert.throws(() => dispatch(s, ready, small.plate), /capacidad de 1 kg/);
  dispatch(s, ready.slice(0, 1), 'GBA-2041');
  assert.equal(s.orders.find((o) => o.id === ready[0])!.vehicle, 'GBA-2041');
});

test('Vehicles validate plates and cannot be removed while on route', () => {
  const s = seed();
  assert.throws(
    () => upsertVehicle(s, { plate: 'gba-2041', label: 'Dup', city: 'Quito', driver: 'X', maxKg: 10, maxM3: 1, costPerKm: 1 }),
    /placa/,
  );
  const onRoute = s.vehicles!.find((v) => v.plate === 'GBA-2041')!;
  assert.throws(() => deleteVehicle(s, onRoute.id), /en ruta/);
  assert.throws(() => upsertVehicle(s, { ...onRoute, active: false }), /en ruta/);
});

test('Receiving against a purchase order tracks partial and full reception', () => {
  const s = seed();
  const po = createPurchase(s, { productId: 'P015', qty: 10 });
  const empty = (id: string) => !s.lots.some((lot) => lot.loc === id && lot.qty > 0);
  const loc = suggest(s, 'P015', 6).find((item) => empty(item.id))!.id;
  receive(s, { productId: 'P015', qty: 6, loc, batch: 'OC-T1', expiry: '2099-01-01', supplier: 'Q', purchaseId: po.id });
  assert.equal(po.status, 'Parcial');
  assert.equal(po.received, 6);
  const loc2 = suggest(s, 'P015', 4).find((item) => empty(item.id))!.id;
  receive(s, { productId: 'P015', qty: 4, loc: loc2, batch: 'OC-T2', expiry: '2099-01-01', supplier: 'Q', purchaseId: po.id });
  assert.equal(po.status, 'Recibida');
  assert.throws(() => cancelPurchase(s, po.id), /recibida/);
  assert.throws(
    () => receive(s, { productId: 'P015', qty: 1, loc: loc2, batch: 'X', expiry: '2099-01-01', supplier: 'Q', purchaseId: po.id }),
    /recibida/,
  );
});

test('Purchase reception rejects another product and cancelled orders', () => {
  const s = seed();
  const po = createPurchase(s, { productId: 'P015', qty: 5 });
  const loc = suggest(s, 'P001', 1).find((item) => !s.lots.some((lot) => lot.loc === item.id && lot.qty > 0))!.id;
  assert.throws(
    () => receive(s, { productId: 'P001', qty: 1, loc, batch: 'X', expiry: '2099-01-01', supplier: 'Q', purchaseId: po.id }),
    /otro producto/,
  );
  cancelPurchase(s, po.id);
  assert.equal(po.status, 'Cancelada');
});

test('Clients are validated, editable and protected when they have orders', () => {
  const s = seed();
  assert.throws(() => createClient(s, { name: 'Nuevo' }), /Completa/);
  const c = createClient(s, {
    name: 'Hostal Test', contact: 'Ana', address: 'Calle 1', email: 'ana@test.ec', type: 'Hotelería', city: 'Quito', taxId: '1790000009001',
  });
  updateClient(s, c.id, { contact: 'Luis', sector: 'Norte', phone: '0990000000', city: 'Quito' });
  assert.equal(s.clients.find((x) => x.id === c.id)!.contact, 'Luis');
  assert.equal(s.clients.find((x) => x.id === c.id)!.phone, '0990000000');
  assert.throws(() => createClient(s, {
    name: 'Otro hostal', contact: 'Ana', address: 'Calle 2', email: 'otro@test.ec', type: 'Hotelería', taxId: '1790000009001',
  }), /RUC/);
  assert.throws(() => updateClient(s, c.id, { email: 'no-es-correo' }), /correo/);
  assert.throws(() => deleteClient(s, 'CL001'), /pedidos/);
  deleteClient(s, c.id);
  assert.equal(s.clients.some((x) => x.id === c.id), false);
  assert.throws(() => createSupplier(s, { name: 'Sin ruc' }), /13 dígitos/);
  createSupplier(s, { name: 'Papel Demo', taxId: '1790000003001' });
  assert.throws(() => createSupplier(s, { name: 'Papel Dos', taxId: '1790000003001' }), /RUC/);
});

test('Staging a prepared order is saved on the order and cleared by dispatch', () => {
  const s = seed();
  const o = createOrder(s, { clientId: 'CL001', lines: [{ productId: 'P001', qty: 2 }] });
  assert.throws(() => stageOrders(s, [o.id], 'GBA-2041'), /preparados/);
  prepare(s, o.id);
  stageOrders(s, [o.id], 'gba-2041');
  assert.equal(o.stagedPlate, 'GBA-2041');
  assert.equal(o.status, 'Preparado');
  unstageOrders(s, [o.id]);
  assert.equal(o.stagedPlate, undefined);
  stageOrders(s, [o.id], 'GBA-2041');
  const truck = s.vehicles!.find((v) => v.plate === 'GBA-2041')!;
  truck.maxKg = 0;
  assert.throws(() => stageOrders(s, [o.id], 'GBA-2041'), /capacidad/);
  assert.equal(o.stagedPlate, 'GBA-2041');
  truck.maxKg = 5000;
  dispatch(s, [o.id], 'GBA-2041');
  assert.equal(o.status, 'En ruta');
  assert.equal(o.stagedPlate, undefined);
});

test('A product without stock or open documents can be deleted', () => {
  const s = seed();
  assert.throws(() => deleteProduct(s, 'P001'), /stock|pedidos|paquete|insumo/);
  upsertProduct(s, {
    id: 'PX-TEMP', sku: 'PX-TEMP', name: 'Temporal', category: 'Hogar', supplier: 'Demo',
    price: 1, min: 1, weight: 0.1, volume: 1, kind: 'finished',
  });
  deleteProduct(s, 'PX-TEMP');
  assert.equal(s.products.some((p) => p.id === 'PX-TEMP'), false);
});

test('Bundles can be created and removed', () => {
  const s = seed();
  const created = saveBundle(s, {
    name: 'Kit Prueba',
    description: 'Solo multiusos',
    lines: [{ productId: 'P001', qty: 1 }],
  });
  assert.equal(s.bundles!.some((b) => b.id === created.id), true);
  deleteBundle(s, created.id);
  assert.equal(s.bundles!.some((b) => b.id === created.id), false);
  assert.throws(() => saveBundle(s, { name: 'Vacío', lines: [] }), /al menos un producto/);
});
