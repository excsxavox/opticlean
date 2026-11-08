import test from 'node:test';
import assert from 'node:assert/strict';
import { seed } from '../src/domain/seed.js';
import { reserved } from '../../frontend/src/shared/lib/inventory.ts';
import {
  buildInventoryRows,
  filterInventoryRows,
  type InventoryFilters,
} from '../../frontend/src/features/inventory/inventoryModel.ts';

function inventoryFixture() {
  const state = seed();
  const baseProduct = state.products[0];
  state.settings.activeWarehouseId = 'WH-QT-01';
  state.products = [
    { ...baseProduct, id: 'P-A', sku: 'LIM-001', name: 'Ácido líquido', category: 'Industrial', supplier: 'Química Andina', min: 10, price: 4 },
    { ...baseProduct, id: 'P-B', sku: 'LIM-002', name: 'Jabón neutro', category: 'Hogar', supplier: 'Química Andina', min: 10, price: 3 },
    { ...baseProduct, id: 'P-C', sku: 'PAP-001', name: 'Papel higiénico', category: 'Institucional', supplier: 'Papelera', min: 10, price: 20 },
    { ...baseProduct, id: 'P-D', sku: 'LIM-004', name: 'Alcohol', category: 'Hospitalaria', supplier: 'Higiene', min: 0, price: 2 },
  ];
  state.lots = [
    { id: 'L-A1', productId: 'P-A', loc: 'A-01-01-D', qty: 12, batch: 'A1', expiry: '2027-01-01', warehouseId: 'WH-QT-01' },
    { id: 'L-A2', productId: 'P-A', loc: 'A-01-01-D', qty: 8, batch: 'A2', expiry: '2027-02-01' },
    { id: 'L-A3', productId: 'P-A', loc: 'B-01-02-D', qty: 5, batch: 'A3', expiry: '2027-03-01', warehouseId: 'WH-QT-01' },
    { id: 'L-B', productId: 'P-B', loc: 'C-01-01-D', qty: 8, batch: 'B', expiry: '2027-01-01', warehouseId: 'WH-QT-01' },
    { id: 'L-C', productId: 'P-C', loc: 'D-01-01-D', qty: 3, batch: 'C', expiry: '2027-01-01', warehouseId: 'WH-QT-01' },
    { id: 'L-OTHER', productId: 'P-A', loc: 'Z-01-01', qty: 100, batch: 'OTHER', expiry: '2027-01-01', warehouseId: 'WH-GYQ-01' },
    { id: 'L-ZERO', productId: 'P-A', loc: 'E-01-01-D', qty: 0, batch: 'ZERO', expiry: '2027-01-01', warehouseId: 'WH-QT-01' },
    { id: 'L-NEG', productId: 'P-A', loc: 'F-01-01-D', qty: -4, batch: 'NEG', expiry: '2027-01-01', warehouseId: 'WH-QT-01' },
  ];
  const baseOrder = state.orders[0];
  state.orders = [
    { ...baseOrder, id: 'O-OPEN', status: 'Por preparar', lines: [{ productId: 'P-A', qty: 5 }, { productId: 'P-C', qty: 5 }] },
    { ...baseOrder, id: 'O-DONE', status: 'Entregado', lines: [{ productId: 'P-A', qty: 100 }] },
  ];
  return state;
}

test('Inventory uses only positive lots in the active warehouse, including legacy default lots', () => {
  const state = inventoryFixture();
  const snapshot = structuredClone(state);
  const rows = buildInventoryRows(state);
  const acid = rows.find((row) => row.product.id === 'P-A')!;
  assert.equal(acid.stock, 25);
  assert.equal(acid.stockValue, 100);
  assert.deepEqual(acid.locations, ['A-01-01-D', 'B-01-02-D']);
  assert.deepEqual(acid.lots.map((lot) => lot.id), ['L-A1', 'L-A2', 'L-A3']);
  assert.equal(rows.length, state.products.length);
  assert.deepEqual(state, snapshot);

  state.settings.activeWarehouseId = 'WH-GYQ-01';
  const otherRows = buildInventoryRows(state);
  assert.equal(otherRows[0].stock, 100);
  assert.deepEqual(otherRows[0].locations, ['Z-01-01']);
  assert.deepEqual(otherRows[0].lots.map((lot) => lot.id), ['L-OTHER']);
  assert.equal(otherRows[1].stock, 0);
  assert.deepEqual(otherRows[1].locations, []);
});

test('Availability retains global pending reservations and identifies shortages, including negative availability', () => {
  const state = inventoryFixture();
  const rows = buildInventoryRows(state);
  assert.deepEqual(rows.map((row) => [row.reserved, row.available, row.status, row.shortage]), [
    [5, 20, 'healthy', 0],
    [0, 8, 'low', 2],
    [5, -2, 'unavailable', 12],
    [0, 0, 'unavailable', 0],
  ]);
  for (const row of rows) assert.equal(row.reserved, reserved(state, row.product.id));
  state.settings.activeWarehouseId = 'WH-GYQ-01';
  assert.equal(buildInventoryRows(state)[0].reserved, 5);
  state.products[1].min = 8;
  state.settings.activeWarehouseId = 'WH-QT-01';
  assert.equal(buildInventoryRows(state)[1].status, 'healthy');
});

test('Inventory search matches all words across normalized names, SKUs, suppliers and current locations', () => {
  const rows = buildInventoryRows(inventoryFixture());
  const ids = (query: string) => filterInventoryRows(rows, { query }).map((row) => row.product.id);
  assert.deepEqual(ids('  ACIDO quimica   b-01-02-d '), ['P-A']);
  assert.deepEqual(ids('industrial LIM-001 P-A'), ['P-A']);
  assert.deepEqual(ids('jabon LIM-002 hogar'), ['P-B']);
  assert.deepEqual(ids('papel higienico papelera'), ['P-C']);
  assert.deepEqual(ids('acido papelera'), []);
  assert.deepEqual(ids('Z-01-01'), []);
  assert.deepEqual(ids('E-01-01-D'), []);
});

test('Inventory category, supplier and stock filters combine without mutating source rows', () => {
  const rows = buildInventoryRows(inventoryFixture());
  const originalOrder = rows.map((row) => row.product.id);
  const ids = (filters: InventoryFilters) => filterInventoryRows(rows, filters).map((row) => row.product.id);
  assert.deepEqual(ids({ status: 'attention' }), ['P-C', 'P-D', 'P-B']);
  assert.deepEqual(ids({ status: 'unavailable' }), ['P-C', 'P-D']);
  assert.deepEqual(ids({ status: 'low' }), ['P-B']);
  assert.deepEqual(ids({ status: 'healthy' }), ['P-A']);
  assert.deepEqual(ids({ status: 'reserved' }), ['P-C', 'P-A']);
  assert.deepEqual(ids({ supplier: 'Química Andina', category: 'Hogar', status: 'attention', query: 'jabon' }), ['P-B']);
  assert.deepEqual(ids({ supplier: 'Papelera', category: 'Hogar' }), []);
  assert.deepEqual(rows.map((row) => row.product.id), originalOrder);
});

test('Inventory ordering prioritizes stock problems and supports quantity, name and value comparisons', () => {
  const rows = buildInventoryRows(inventoryFixture());
  const ids = (sort: InventoryFilters['sort']) => filterInventoryRows(rows, { sort }).map((row) => row.product.id);
  assert.deepEqual(ids('attention'), ['P-C', 'P-D', 'P-B', 'P-A']);
  assert.deepEqual(ids('name'), ['P-A', 'P-D', 'P-B', 'P-C']);
  assert.deepEqual(ids('stock-desc'), ['P-A', 'P-B', 'P-C', 'P-D']);
  assert.deepEqual(ids('available-asc'), ['P-C', 'P-D', 'P-B', 'P-A']);
  assert.deepEqual(ids('value-desc'), ['P-A', 'P-C', 'P-B', 'P-D']);

  const equalRows = rows.map((row) => ({
    ...row, stock: 0, available: 0, shortage: 10, stockValue: 0, status: 'unavailable' as const,
    product: { ...row.product, name: 'Producto' },
  })).reverse();
  assert.deepEqual(filterInventoryRows(equalRows).map((row) => row.product.id), ['P-A', 'P-B', 'P-C', 'P-D']);
});
