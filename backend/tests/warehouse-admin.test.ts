import test from 'node:test';
import assert from 'node:assert/strict';
import { seed } from '../src/domain/seed.js';
import type { WarehouseSite } from '../src/domain/types.js';
import {
  activateWarehouse,
  createWarehouse,
  upsertWarehouse,
} from '../src/domain/warehouse-admin.service.js';

function warehouse(overrides: Partial<WarehouseSite> = {}): WarehouseSite {
  return {
    id: 'WH-TEST',
    code: 'BOD-TEST',
    name: 'Bodega de prueba',
    city: '',
    address: '',
    status: 'Operativa',
    racks: 2,
    layout: { rackCount: 2, levels: 2, positionsPerLevel: 3, capacityPerCell: 60, depthFaces: 1 },
    ...overrides,
  };
}

test('Creating a warehouse normalizes text and accepts omitted optional location details', () => {
  const state = seed();
  const body = warehouse({
    code: '  bod-test  ',
    name: '  Bodega nueva  ',
    notes: '  Acceso norte  ',
  });
  const { city: _city, address: _address, ...withoutLocation } = body;
  const id = createWarehouse(state, withoutLocation as WarehouseSite);
  const created = state.warehouses.find((item) => item.id === id)!;
  assert.equal(created.code, 'BOD-TEST');
  assert.equal(created.name, 'Bodega nueva');
  assert.equal(created.notes, 'Acceso norte');
  assert.equal(created.city, '');
  assert.equal(created.address, '');
  assert.equal(created.racks, created.layout.rackCount);
});

test('Creating and editing reject duplicate codes regardless of case or surrounding spaces', () => {
  const state = seed();
  state.warehouses[0].code = '  BOD-QTO  ';
  const before = structuredClone(state);
  assert.throws(
    () => createWarehouse(state, warehouse({ code: ' bod-qto ' })),
    /Ya existe una bodega con este código/,
  );
  assert.throws(
    () => upsertWarehouse(state, { ...state.warehouses[1], code: 'bod-qto' }),
    /Ya existe una bodega con este código/,
  );
  assert.deepEqual(state, before);
});

test('An active warehouse can keep its own code and updates the operation label', () => {
  const state = seed();
  const active = state.warehouses[0];
  upsertWarehouse(state, {
    ...active,
    code: ' bod-qto ',
    name: '  Principal norte ',
    city: ' Quito ',
    address: ' Av. Central ',
  });
  assert.equal(active.code, 'BOD-QTO');
  assert.equal(active.name, 'Principal norte');
  assert.equal(active.address, 'Av. Central');
  assert.equal(state.settings.warehouse, 'Principal norte · Quito');
});

test('Missing, blank, or invalid required text receives a clear validation error', () => {
  for (const field of ['code', 'name'] as const) {
    for (const value of [undefined, null, '', '   ', 123]) {
      const state = seed();
      const before = structuredClone(state);
      assert.throws(
        () => createWarehouse(state, warehouse({ [field]: value } as Partial<WarehouseSite>)),
        /Código y nombre de bodega son obligatorios/,
      );
      assert.deepEqual(state, before);
    }
  }
});

test('Unknown status is rejected when creating or editing', () => {
  const state = seed();
  const before = structuredClone(state);
  const status = 'Pendiente' as WarehouseSite['status'];
  assert.throws(() => createWarehouse(state, warehouse({ status })), /estado válido/);
  assert.throws(() => upsertWarehouse(state, { ...state.warehouses[1], status }), /estado válido/);
  assert.deepEqual(state, before);
});

test('The warehouse in use cannot be disabled until another warehouse is selected', () => {
  const state = seed();
  const active = state.warehouses[0];
  assert.throws(
    () => upsertWarehouse(state, { ...active, status: 'Inactiva' }),
    /Selecciona otra para operar primero/,
  );
  assert.equal(active.status, 'Operativa');
  activateWarehouse(state, state.warehouses[1].id);
  upsertWarehouse(state, { ...active, status: 'Inactiva' });
  assert.equal(active.status, 'Inactiva');
});

test('Capacity validation sums every lot in a location and leaves rejected edits unchanged', () => {
  const state = seed();
  const target = state.warehouses[1];
  state.lots.push(
    { id: 'capacity-a', productId: 'P001', loc: 'A-01-01', qty: 18, batch: 'A', expiry: '2099-01-01', warehouseId: target.id },
    { id: 'capacity-b', productId: 'P001', loc: 'A-01-01', qty: 17, batch: 'B', expiry: '2099-01-01', warehouseId: target.id },
  );
  const before = structuredClone(state);
  assert.throws(
    () => upsertWarehouse(state, { ...target, layout: { ...target.layout, capacityPerCell: 30 } }),
    /A-01-01 tiene 35 u.*capacidad de 30 u/,
  );
  assert.deepEqual(state, before);
  upsertWarehouse(state, { ...target, layout: { ...target.layout, capacityPerCell: 35 } });
  assert.equal(target.layout.capacityPerCell, 35);
});

test('Capacity checks do not count stock from another warehouse at the same location', () => {
  const state = seed();
  const target = state.warehouses[1];
  state.lots.push(
    { id: 'other-stock', productId: 'P001', loc: 'A-01-01', qty: 100, batch: 'A', expiry: '2099-01-01', warehouseId: state.warehouses[2].id },
    { id: 'target-stock', productId: 'P001', loc: 'A-01-01', qty: 10, batch: 'B', expiry: '2099-01-01', warehouseId: target.id },
  );
  upsertWarehouse(state, { ...target, layout: { ...target.layout, capacityPerCell: 10 } });
  assert.equal(target.layout.capacityPerCell, 10);
});

test('Changing a layout cannot remove an occupied location', () => {
  const state = seed();
  const active = state.warehouses[0];
  const before = structuredClone(state);
  assert.throws(
    () => upsertWarehouse(state, { ...active, layout: { ...active.layout, rackCount: 1 } }),
    /fuera del nuevo diseño/,
  );
  assert.deepEqual(state, before);
});
