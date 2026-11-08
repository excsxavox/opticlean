import test from 'node:test';
import assert from 'node:assert/strict';
import { seed } from '../src/domain/seed.js';
import { migrateState } from '../src/domain/state-migrate.js';
import { buildWarehouseGeometry, normalizeLayout } from '../src/domain/warehouse-layout.js';
import { normalizeRackPositions } from '../src/domain/rack-positioning.js';
import { upsertWarehouse } from '../src/domain/warehouse-admin.service.js';
import { OperationsUseCases } from '../src/application/use-cases/OperationsUseCases.js';
import type { AppState, RackPosition } from '../src/domain/types.js';
import { moveRack, rackPositions, normalizeRackPositions as frontendPositions } from '../../frontend/src/shared/lib/rackPositioning.ts';
import { buildWarehouseGeometry as frontendGeometry, normalizeLayout as frontendLayout } from '../../frontend/src/shared/lib/warehouseLayout.ts';

test('Legacy layouts keep rack coordinates and every location code', () => {
  const layout = normalizeLayout();
  const geometry = buildWarehouseGeometry(layout);
  assert.deepEqual(geometry.racks.map(({ id, x, y }) => ({ id, x, y })), [
    { id: 'A', x: 1, y: 1 }, { id: 'B', x: 6, y: 1 },
    { id: 'C', x: 1, y: 3.4 }, { id: 'D', x: 6, y: 3.4 },
    { id: 'E', x: 1, y: 5.8 }, { id: 'F', x: 6, y: 5.8 },
  ]);
  assert.equal(geometry.totalCells, 72);
  assert.equal(geometry.locations[0].id, 'A-01-01');
});

test('Frontend and API agree on positions and codes for all rack counts and both depth modes', () => {
  for (let rackCount = 1; rackCount <= 12; rackCount++) {
    for (const depthFaces of [1, 2] as const) {
      const positions = [{ rackId: 'A', column: 3, row: 5 }];
      const input = { rackCount, levels: 5, positionsPerLevel: 8, capacityPerCell: 200, depthFaces, rackPositions: positions };
      const backend = buildWarehouseGeometry(normalizeLayout(input));
      const frontend = frontendGeometry(frontendLayout(input));
      assert.deepEqual(frontendPositions(rackCount, positions), normalizeRackPositions(rackCount, positions));
      assert.deepEqual(frontend.racks.map(({ id, x, y }) => ({ id, x, y })), backend.racks.map(({ id, x, y }) => ({ id, x, y })));
      assert.deepEqual(frontend.locations.map(({ id, capacity }) => ({ id, capacity })), backend.locations.map(({ id, capacity }) => ({ id, capacity })));
      assert.equal(backend.totalCells, rackCount * 5 * 8 * depthFaces);
      assert.equal(backend.racks[0].x, 16);
      assert.equal(backend.racks[0].y, 13);
    }
  }
});

test('Moving onto a rack swaps positions and retains every rack exactly once', () => {
  const initial = normalizeLayout();
  const original = rackPositions(initial);
  const swapped = rackPositions(moveRack(initial, 'A', 1, 0));
  assert.deepEqual(swapped[0], { rackId: 'A', column: 1, row: 0 });
  assert.deepEqual(swapped[1], { rackId: 'B', column: 0, row: 0 });
  assert.deepEqual(swapped.slice(2), original.slice(2));
  assert.equal(new Set(swapped.map(({ column, row }) => `${column}:${row}`)).size, initial.rackCount);
  assert.equal(moveRack(initial, 'A', -1, 0), initial);
  assert.equal(moveRack(initial, 'A', 4, 0), initial);
  assert.equal(moveRack(initial, 'A', 0, 6), initial);
  assert.equal(moveRack(initial, 'Z', 0, 0), initial);
});

test('Resizing retains existing placements and adds racks only in unoccupied modules', () => {
  const initial = moveRack(normalizeLayout({ rackCount: 2 }), 'A', 1, 1);
  const expanded = frontendLayout({ ...initial, rackCount: 12 });
  const positions = rackPositions(expanded);
  assert.deepEqual(positions[0], { rackId: 'A', column: 1, row: 1 });
  assert.equal(new Set(positions.map(({ column, row }) => `${column}:${row}`)).size, 12);
  assert.equal(rackPositions(frontendLayout({ ...expanded, rackCount: 1 })).length, 1);
});

test('Invalid physical placements are rejected without mutating the warehouse or inventory', () => {
  const invalid: unknown[] = [
    [{ rackId: 'A', column: 0, row: 0 }, { rackId: 'B', column: 0, row: 0 }],
    [{ rackId: 'A', column: 4, row: 0 }], [{ rackId: 'A', column: 0, row: 6 }],
    [{ rackId: 'A', column: 0.5, row: 0 }], [{ rackId: 'Z', column: 0, row: 0 }],
    [{ rackId: 'A', column: 0, row: 0 }, { rackId: 'A', column: 1, row: 1 }], null, {},
  ];
  for (const rackPositions of invalid) {
    const state = seed();
    const before = structuredClone(state);
    const warehouse = state.warehouses[0];
    assert.throws(() => upsertWarehouse(state, { ...warehouse, layout: { ...warehouse.layout, rackPositions: rackPositions as RackPosition[] } }));
    assert.deepEqual(state, before);
  }
});

test('Saved and reloaded rack placements preserve stock, references, and location codes', async () => {
  let persisted = seed();
  const repo = {
    load: async () => structuredClone(persisted),
    save: async (state: AppState) => { persisted = JSON.parse(JSON.stringify(state)) as AppState; },
    reset: async () => seed(),
  };
  const ops = new OperationsUseCases(repo);
  const before = structuredClone(persisted);
  const warehouse = before.warehouses[0];
  const locations = buildWarehouseGeometry(warehouse.layout).locations.map(({ id }) => id);
  const layout = moveRack(warehouse.layout, 'A', 3, 5);
  await ops.saveWarehouse({ ...warehouse, layout });
  const reloaded = await ops.getState();
  const meta = await ops.getMeta();
  assert.deepEqual(reloaded.lots, before.lots);
  assert.deepEqual(reloaded.events, before.events);
  assert.deepEqual(reloaded.orders, before.orders);
  assert.deepEqual(meta.locations.map(({ id }) => id), locations);
  assert.equal(meta.racks.find(({ id }) => id === 'A')!.x, 16);
  assert.equal(meta.racks.find(({ id }) => id === 'A')!.y, 13);
  assert.deepEqual(migrateState(structuredClone(reloaded)).warehouses[0].layout.rackPositions, layout.rackPositions);
});

test('Invalid numeric layout data cannot produce NaN coordinates or an empty geometry', () => {
  const input = { rackCount: NaN, levels: Infinity, positionsPerLevel: NaN, capacityPerCell: NaN };
  const backend = buildWarehouseGeometry(normalizeLayout(input));
  const frontend = frontendGeometry(frontendLayout(input));
  assert.equal(backend.totalCells, 1);
  assert.equal(frontend.totalCells, 1);
  assert.equal(backend.locations[0].capacity, 10);
});
