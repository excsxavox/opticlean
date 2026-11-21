import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { seed } from '../src/domain/seed.js';
import { migrateState } from '../src/domain/state-migrate.js';
import type { AppState } from '../src/domain/types.js';
import { runAs, type RequestActor } from '../src/domain/request-context.js';
import { OperationsUseCases } from '../src/application/use-cases/OperationsUseCases.js';
import type { StateRepository } from '../src/application/ports/StateRepository.js';
import {
  loginBlockedFor,
  registerLoginFailure,
  registerLoginSuccess,
  resetLoginThrottle,
} from '../src/infrastructure/http/login-throttle.js';
import { backupAuthData } from '../src/infrastructure/persistence/auth-backup.js';

function memoryRepo(initial: AppState): StateRepository & { state: AppState } {
  const repo = {
    state: initial,
    load: async () => structuredClone(repo.state),
    save: async (s: AppState) => { repo.state = structuredClone(s); },
    reset: async () => repo.state,
    transaction: async <T,>(fn: (s: AppState) => T | Promise<T>) => {
      const s = structuredClone(repo.state);
      const result = await fn(s);
      repo.state = structuredClone(s);
      return { state: s, result };
    },
  };
  return repo;
}

const admin: RequestActor = { id: 'U-ADMIN', name: 'Administración', role: 'admin', companyId: 'co-innovamf' };
const bodega: RequestActor = { id: 'U-BODEGA', name: 'Bodega piso', role: 'ops', companyId: 'co-innovamf' };

test('Se puede cancelar un pedido que espera stock y sale de su OC', async () => {
  const repo = memoryRepo(migrateState(seed()));
  const ops = new OperationsUseCases(repo);
  const id = await runAs(admin, () =>
    ops.placeOrder({ clientId: 'CL001', lines: [{ productId: 'P015', qty: 300 }], backorder: true }),
  );
  const order = repo.state.orders.find((o) => o.id === id)!;
  assert.equal(order.status, 'Esperando stock');
  const poId = order.purchaseIds![0];
  await runAs(bodega, () => ops.cancelClientOrder(id, 'El cliente ya no lo necesita'));
  const after = repo.state.orders.find((o) => o.id === id)!;
  assert.equal(after.status, 'Cancelado');
  assert.ok(!repo.state.purchases.find((p) => p.id === poId)!.orderIds?.includes(id));
  assert.equal(repo.state.events[0].by, 'Bodega piso');
  await assert.rejects(() => runAs(bodega, () => ops.cancelClientOrder(id, 'otra vez')), /Solo se pueden cancelar/);
});

test('Bodega no cambia precio, costo ni IVA; administración sí y queda en el historial', async () => {
  const repo = memoryRepo(migrateState(seed()));
  const ops = new OperationsUseCases(repo);
  const before = repo.state.products.find((p) => p.id === 'P015')!;

  await assert.rejects(
    () => runAs(bodega, () => ops.saveProduct({ ...before, price: 1, originalId: before.id })),
    /Solo administración/,
  );
  // Bodega puede editar la ficha si no toca datos de dinero; el costo que envíe se ignora.
  await runAs(bodega, () => ops.saveProduct({ ...before, min: 99, ivaRate: 0.15, avgCost: 0.01, originalId: before.id }));
  const edited = repo.state.products.find((p) => p.id === 'P015')!;
  assert.equal(edited.min, 99);
  assert.equal(edited.avgCost, before.avgCost);
  assert.equal(repo.state.auditLog?.length ?? 0, 0);

  await runAs(admin, () => ops.saveProduct({ ...edited, price: 7.5, avgCost: 4.2, originalId: edited.id }));
  const log = repo.state.auditLog ?? [];
  assert.deepEqual(
    log.map((a) => [a.field, a.from, a.to, a.by]).sort(),
    [
      ['Costo promedio', String(before.avgCost), '4.2', 'Administración'],
      ['Precio de venta', String(before.price), '7.5', 'Administración'],
    ].sort(),
  );
});

test('Cupo y plazo de crédito: solo administración, con historial', async () => {
  const repo = memoryRepo(migrateState(seed()));
  const ops = new OperationsUseCases(repo);
  const base = { name: 'Nuevo', contact: 'X', address: 'Y', email: 'n@x.ec', type: 'Retail', taxId: '1790000099001' };

  await runAs(bodega, () => ops.addClient({ ...base, creditLimit: 1_000_000, paymentTermsDays: 365 }));
  const byOps = repo.state.clients.at(-1)!;
  assert.equal(byOps.creditLimit, 3000, 'bodega crea con el cupo por defecto');
  assert.equal(byOps.paymentTermsDays, undefined);

  await assert.rejects(() => runAs(bodega, () => ops.updateClient(byOps.id, { creditLimit: 9000 })), /Solo administración/);
  await runAs(admin, () => ops.updateClient(byOps.id, { creditLimit: 9000, paymentTermsDays: 45 }));
  const updated = repo.state.clients.find((c) => c.id === byOps.id)!;
  assert.equal(updated.creditLimit, 9000);
  assert.equal(updated.paymentTermsDays, 45);
  const fields = (repo.state.auditLog ?? []).filter((a) => a.entityId === byOps.id).map((a) => `${a.field}:${a.from}→${a.to}`);
  assert.ok(fields.includes('Cupo de crédito:3000→9000'));
  assert.ok(fields.includes('Plazo de pago (días):→45'));
});

test('Inicio de sesión: 5 fallos bloquean la cuenta 15 minutos; un acierto limpia el contador', () => {
  resetLoginThrottle();
  const now = 1_000_000;
  for (let i = 0; i < 4; i++) registerLoginFailure('1.1.1.1', 'a@x.ec', now);
  assert.equal(loginBlockedFor('1.1.1.1', 'a@x.ec', now), 0);
  registerLoginSuccess('1.1.1.1', 'a@x.ec');
  for (let i = 0; i < 4; i++) registerLoginFailure('1.1.1.1', 'a@x.ec', now);
  assert.equal(loginBlockedFor('1.1.1.1', 'a@x.ec', now), 0, 'el acierto reinició el contador');
  registerLoginFailure('1.1.1.1', 'a@x.ec', now);
  assert.equal(loginBlockedFor('1.1.1.1', 'A@X.EC', now), 900);
  assert.equal(loginBlockedFor('2.2.2.2', 'a@x.ec', now), 0, 'otra IP no queda bloqueada');
  assert.equal(loginBlockedFor('1.1.1.1', 'a@x.ec', now + 15 * 60 * 1000 + 1), 0, 'se libera a los 15 minutos');
  resetLoginThrottle();
});

test('Respaldo diario de usuarios y de la base de empresas', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'opticlean-bk-'));
  try {
    await backupAuthData(dir, '2026-01-01');
    const files = await readdir(dir);
    assert.ok(files.includes('admin-2026-01-01.db'), 'copia consistente de admin.db');
    assert.ok(files.includes('users-2026-01-01.json'), 'copia de users.json');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
