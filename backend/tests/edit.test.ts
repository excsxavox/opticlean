import test from 'node:test';
import assert from 'node:assert/strict';
import { seed } from '../src/domain/seed.js';
import { migrateState } from '../src/domain/state-migrate.js';
import { available, createOrder, editOrder, prepare } from '../src/domain/inventory.service.js';
import { createPurchase, editPurchase, receivePurchase, createClient, deleteClient } from '../src/domain/commerce.service.js';
import { suggest } from '../src/domain/placement.service.js';
import { runAs } from '../src/domain/request-context.js';

const fresh = () => migrateState(seed());

function sellable(s: ReturnType<typeof fresh>, min = 3) {
  return s.products.find((p) => p.kind !== 'raw' && available(s, p.id) >= min && !p.requiresSanitary)!;
}

test('Editar pedido: cambia cantidades y conserva número y fecha', () => {
  const s = fresh();
  const item = sellable(s);
  const client = s.clients[0];
  const order = createOrder(s, { clientId: client.id, lines: [{ productId: item.id, qty: 1 }] });
  const { id, date } = order;
  const edited = editOrder(s, id, { lines: [{ productId: item.id, qty: 2 }], notes: 'Cambio de cantidad' });
  assert.equal(edited.id, id);
  assert.equal(edited.date, date);
  assert.equal(edited.lines[0].qty, 2);
  assert.equal(edited.notes, 'Cambio de cantidad');
  assert.equal(s.orders.filter((o) => o.id === id).length, 1);
});

test('Editar pedido: si la nueva versión no pasa, el pedido queda intacto', () => {
  const s = fresh();
  const item = sellable(s);
  const order = createOrder(s, { clientId: s.clients[0].id, lines: [{ productId: item.id, qty: 1 }] });
  const index = s.orders.findIndex((o) => o.id === order.id);
  assert.throws(
    () => editOrder(s, order.id, { lines: [{ productId: item.id, qty: 9_999_999 }] }),
    /Stock insuficiente/,
  );
  assert.equal(s.orders.findIndex((o) => o.id === order.id), index);
  assert.equal(s.orders[index].lines[0].qty, 1);
});

test('Editar pedido: solo mientras está por preparar', () => {
  const s = fresh();
  const item = sellable(s);
  const order = createOrder(s, { clientId: s.clients[0].id, lines: [{ productId: item.id, qty: 1 }] });
  prepare(s, order.id);
  assert.throws(() => editOrder(s, order.id, { notes: 'tarde' }), /todavía no se prepara/);
  assert.throws(() => editOrder(s, 'PED-NO-EXISTE', {}), /no encontrado/);
});

test('Editar orden de compra: reemplaza líneas y conserva el número', () => {
  const s = fresh();
  const item = s.products[0];
  const po = createPurchase(s, { lines: [{ productId: item.id, qty: 5, packCode: 'unidad', unitPrice: 2 }] });
  const edited = editPurchase(s, po.id, { lines: [{ productId: item.id, qty: 8, packCode: 'unidad', unitPrice: 3 }] });
  assert.equal(edited.id, po.id);
  assert.equal(edited.lines![0].qty, 8);
  assert.equal(edited.lines![0].unitPrice, 3);
  assert.equal(s.purchases.filter((p) => p.id === po.id).length, 1);
});

test('Editar orden de compra: no si ya recibió mercadería', () => {
  const s = fresh();
  const lot = s.lots.find((l) => l.expiry > '2027-01-01' && s.products.some((p) => p.id === l.productId && !p.inspectOnReceipt))!;
  const item = s.products.find((p) => p.id === lot.productId)!;
  const po = createPurchase(s, { lines: [{ productId: item.id, qty: 5, packCode: 'unidad', unitPrice: 2 }] });
  runAs({ id: 'u', name: 'Test', role: 'admin', companyId: 'co-innovamf' }, () => {
    receivePurchase(s, po.id, {
      lines: [{ productId: item.id, qty: 2, packCode: 'unidad', loc: lot.loc, batch: lot.batch, expiry: lot.expiry }],
    } as never);
  });
  assert.throws(() => editPurchase(s, po.id, { lines: [{ productId: item.id, qty: 9 }] }), /sin mercadería recibida/);
});

test('Eliminar cliente: solo sin historial de pedidos', () => {
  const s = fresh();
  const created = createClient(s, {
    name: 'Cliente Borrable',
    contact: 'Luis',
    address: 'Av. 1',
    email: 'luis@cliente.com',
    type: 'Oficina',
    taxId: '1790099999001',
  });
  deleteClient(s, created.id);
  assert.equal(s.clients.some((c) => c.id === created.id), false);
  const withOrders = s.orders[0]?.clientId;
  assert.ok(withOrders);
  assert.throws(() => deleteClient(s, withOrders), /pedidos/);
});
