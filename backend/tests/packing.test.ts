import test from 'node:test';
import assert from 'node:assert/strict';
import { seed } from '../src/domain/seed.js';
import { migrateState } from '../src/domain/state-migrate.js';
import { createOrder, dispatch, orderLoad, prepare } from '../src/domain/inventory.service.js';
import { cancelOrder } from '../src/domain/commerce.service.js';
import { loadPreview } from '../src/domain/outbound.service.js';
import { syncFleet, vehicleByPlate } from '../src/domain/fleet.service.js';
import {
  assertPackedForDispatch,
  closePacking,
  confirmLoad,
  createParcel,
  deleteParcel,
  expectedWeight,
  packingProblems,
  parcelsOf,
  releaseLoad,
  reopenPacking,
  updateParcel,
} from '../src/domain/packing.service.js';
import type { AppState } from '../src/domain/types.js';
import { packAll } from './helpers/pack.js';

const fresh = () => migrateState(seed());

function prepared(s: AppState, lines: Array<{ productId: string; qty: number }>, clientId = 'CL001') {
  const order = createOrder(s, { clientId, lines });
  prepare(s, order.id);
  return order;
}

const contentOf = (s: AppState, orderId: string) =>
  s.orders
    .find((o) => o.id === orderId)!
    .picks!.map((p) => ({ productId: p.productId, batch: p.batch ?? '', qty: p.qty }));

test('Empaque: solo pedidos preparados y nunca más unidades que las preparadas', () => {
  const s = fresh();
  const pending = createOrder(s, { clientId: 'CL001', lines: [{ productId: 'P001', qty: 2 }] });
  assert.throws(() => createParcel(s, { orderId: pending.id }), /preparado/);
  prepare(s, pending.id);
  const [line] = contentOf(s, pending.id);
  const a = createParcel(s, { orderId: pending.id });
  const b = createParcel(s, { orderId: pending.id });
  assert.notEqual(a.id, b.id);
  updateParcel(s, a.id, { contents: [{ ...line, qty: line.qty }] });
  assert.throws(() => updateParcel(s, b.id, { contents: [{ ...line, qty: 1 }] }), /más unidades/);
  assert.throws(
    () => updateParcel(s, b.id, { contents: [{ productId: 'P012', batch: 'X', qty: 1 }] }),
    /no está en este pedido/,
  );
});

test('Empaque: químicos incompatibles no comparten bulto y el bulto queda intacto', () => {
  const s = fresh();
  s.products.find((p) => p.id === 'P001')!.hazardClass = 'base';
  s.products.find((p) => p.id === 'P012')!.hazardClass = 'chlorinated';
  const order = prepared(s, [
    { productId: 'P001', qty: 1 },
    { productId: 'P012', qty: 1 },
  ]);
  const contents = contentOf(s, order.id);
  const parcel = createParcel(s, { orderId: order.id });
  assert.throws(() => updateParcel(s, parcel.id, { contents, weightKg: 3 }), /No se puede juntar/);
  assert.deepEqual(parcel.contents, []);
  assert.equal(parcel.weightKg, 0, 'si algo falla no se guarda nada');
});

test('Empaque: cerrar exige todo adentro, pesado y con motivo si el peso no coincide', () => {
  const s = fresh();
  const order = prepared(s, [{ productId: 'P001', qty: 3 }]);
  assert.match(packingProblems(s, order)[0], /al menos un bulto/);
  const parcel = createParcel(s, { orderId: order.id, boxCode: 'S' });
  const [line] = contentOf(s, order.id);
  updateParcel(s, parcel.id, { contents: [{ ...line, qty: 1 }] });
  assert.throws(() => closePacking(s, order.id), /Faltan/);
  updateParcel(s, parcel.id, { contents: contentOf(s, order.id) });
  assert.throws(() => closePacking(s, order.id), /sin pesar/);
  updateParcel(s, parcel.id, { weightKg: expectedWeight(s, parcel) * 2 });
  assert.throws(() => closePacking(s, order.id), /sin motivo/);
  updateParcel(s, parcel.id, { weightNote: 'Incluye pallet' });
  closePacking(s, order.id);
  assert.ok(order.packing);
  assert.ok(s.events.some((e) => e.type === 'Empaque' && e.ref === order.id));
  assert.throws(() => updateParcel(s, parcel.id, { weightKg: 1 }), /cerrado/);
  assert.throws(() => deleteParcel(s, parcel.id), /cerrado/);
  reopenPacking(s, order.id);
  deleteParcel(s, parcel.id);
  assert.equal(parcelsOf(s, order.id).length, 0);
});

test('Empaque: medidas propias calculan el volumen y se validan', () => {
  const s = fresh();
  const order = prepared(s, [{ productId: 'P001', qty: 1 }]);
  const parcel = createParcel(s, { orderId: order.id, boxCode: 'custom', dims: { l: 100, w: 100, h: 50 } });
  assert.equal(parcel.volumeM3, 0.5);
  assert.throws(() => updateParcel(s, parcel.id, { dims: { l: 0, w: 1, h: 1 } }), /centímetros/);
});

test('Empaque: un bulto antiguo sin detalle impide cerrar', () => {
  const s = fresh();
  const order = prepared(s, [{ productId: 'P001', qty: 1 }]);
  s.parcels = [{ id: 'BUL-0001', orderId: order.id, weightKg: 2, volumeM3: 0.1, packedAt: new Date().toISOString() }];
  assert.throws(() => closePacking(s, order.id), /sin detalle/);
});

test('Carga del pedido: catálogo hasta cerrar el empaque, luego lo medido', () => {
  const s = fresh();
  const order = prepared(s, [{ productId: 'P001', qty: 2 }]);
  const theoretical = orderLoad(s, order);
  assert.equal(theoretical.packed, false);
  packAll(s, order.id);
  const measured = orderLoad(s, order);
  assert.equal(measured.packed, true);
  assert.equal(measured.m3, parcelsOf(s, order.id).reduce((n, p) => n + p.volumeM3, 0));
});

test('Cancelar un pedido anula sus bultos', () => {
  const s = fresh();
  const order = prepared(s, [{ productId: 'P001', qty: 1 }]);
  packAll(s, order.id);
  cancelOrder(s, order.id, 'El cliente desistió');
  assert.equal(parcelsOf(s, order.id).length, 0);
  assert.equal(order.packing, undefined);
});

test('Carga: exige empaque, guarda las paradas, bloquea reabrir y se puede retirar', () => {
  const s = fresh();
  const a = prepared(s, [{ productId: 'P001', qty: 1 }]);
  const b = prepared(s, [{ productId: 'P001', qty: 1 }]);
  assert.throws(() => confirmLoad(s, { plate: 'GBA-2041', orderIds: [a.id] }), /empaque cerrado/);
  packAll(s, a.id);
  packAll(s, b.id);
  confirmLoad(s, { plate: 'gba-2041', orderIds: [b.id, a.id] });
  assert.deepEqual([a.stagedPlate, a.stopOrder, b.stopOrder], ['GBA-2041', 2, 1]);
  assert.throws(() => reopenPacking(s, a.id), /cargado/);
  assert.throws(() => confirmLoad(s, { plate: 'GYE-1188', orderIds: [a.id] }), /ya está cargado/);
  assert.throws(() => dispatch(s, [a.id], 'GYE-1188'), /está cargado en/);
  // Confirmar de nuevo reemplaza la carga: lo que ya no va se baja.
  confirmLoad(s, { plate: 'GBA-2041', orderIds: [a.id] });
  assert.equal(b.stagedPlate, undefined);
  assert.equal(b.stopOrder, undefined);
  releaseLoad(s, 'GBA-2041');
  assert.equal(a.stagedPlate, undefined);
  assert.throws(() => releaseLoad(s, 'GBA-2041'), /no tiene carga/);
});

test('Carga: fuera de zona pide motivo y la capacidad bloquea', () => {
  const s = fresh();
  const order = prepared(s, [{ productId: 'P001', qty: 1 }]);
  packAll(s, order.id);
  assert.throws(
    () => confirmLoad(s, { plate: 'GBA-2041', orderIds: [order.id], outOfZone: [order.id] }),
    /motivo/,
  );
  confirmLoad(s, { plate: 'GBA-2041', orderIds: [order.id], outOfZone: [order.id], reason: 'Viaje especial' });
  assert.equal(order.loadNote, 'Viaje especial');
  releaseLoad(s, 'GBA-2041');
  vehicleByPlate(s, 'GBA-2041')!.maxKg = 0.5;
  assert.throws(() => confirmLoad(s, { plate: 'GBA-2041', orderIds: [order.id] }), /capacidad/);
});

test('Carga: la vista previa respeta el orden de entrega y la flota de Logística', () => {
  const s = fresh();
  const a = prepared(s, [{ productId: 'P001', qty: 1 }]);
  const b = prepared(s, [{ productId: 'P001', qty: 1 }]);
  const truck = { plate: 'NEW-0001', maxKg: 1000, maxM3: 5, costPerKm: 1, city: 'Cuenca', routeKm: 60 };
  const preview = loadPreview(s, 'NEW-0001', [a.id, b.id], truck);
  assert.deepEqual(preview.loadSequence, [b.id, a.id]);
  assert.deepEqual(preview.outOfZone, [a.id, b.id]);
  assert.ok(preview.trip.km > 0);
  assert.equal(preview.trip.cost, preview.trip.km);
  syncFleet(s, [{ ...truck, label: 'Nuevo' }]);
  assert.equal(vehicleByPlate(s, 'new-0001')!.maxKg, 1000);
});

test('Despacho: exige empaque salvo que la regla esté apagada', () => {
  const s = fresh();
  const order = prepared(s, [{ productId: 'P001', qty: 1 }]);
  assert.throws(() => assertPackedForDispatch(s, [order.id]), /Falta empacar/);
  s.settings.businessRules = { ...s.settings.businessRules!, requirePackingBeforeDispatch: false };
  assert.doesNotThrow(() => assertPackedForDispatch(s, [order.id]));
  s.settings.businessRules = { ...s.settings.businessRules!, requirePackingBeforeDispatch: true };
  packAll(s, order.id);
  assert.doesNotThrow(() => assertPackedForDispatch(s, [order.id]));
});
