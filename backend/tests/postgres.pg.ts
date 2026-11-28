/**
 * Pruebas del repositorio PostgreSQL. Necesitan una base real, por eso no corren en `npm test`:
 *
 *   TEST_DATABASE_URL=postgres://user:pass@localhost:5432/opticlean_test npm run test:pg
 *
 * Usa tablas propias de la base indicada; no la apuntes a producción.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { PostgresStateRepository } from '../src/infrastructure/persistence/PostgresStateRepository.js';
import { runAs } from '../src/domain/request-context.js';

const url = process.env.TEST_DATABASE_URL?.trim();
const skip = url ? false : 'Define TEST_DATABASE_URL para correr las pruebas de PostgreSQL.';

let pool: pg.Pool;
let repo: PostgresStateRepository;
const asCompany = <T>(companyId: string, fn: () => Promise<T>) =>
  runAs({ id: 'u', name: 'Test', role: 'admin', companyId }, fn);

before(async () => {
  if (!url) return;
  pool = new pg.Pool({ connectionString: url });
  repo = new PostgresStateRepository(pool);
  await pool.query('DROP TABLE IF EXISTS app_state, app_state_backup');
});

after(async () => {
  if (pool) await pool.end();
});

test('PG: la primera lectura crea el estado inicial de la empresa', { skip }, async () => {
  const demo = await asCompany('co-innovamf', () => repo.load());
  assert.ok(demo.products.length > 0, 'la empresa por defecto parte de la demo');
  const empty = await asCompany('co-nueva', () => repo.load());
  assert.equal(empty.products.length, 0);
});

test('PG: una transacción guarda y la siguiente lectura la ve', { skip }, async () => {
  await asCompany('co-innovamf', () =>
    repo.transaction((s) => {
      s.settings.operator = 'Operador PG';
    }),
  );
  const again = await asCompany('co-innovamf', () => repo.load());
  assert.equal(again.settings.operator, 'Operador PG');
});

test('PG: si la transacción falla, no se guarda nada', { skip }, async () => {
  await assert.rejects(
    asCompany('co-innovamf', () =>
      repo.transaction((s) => {
        s.settings.operator = 'No debe guardarse';
        throw new Error('falla a propósito');
      }),
    ),
    /falla a propósito/,
  );
  const state = await asCompany('co-innovamf', () => repo.load());
  assert.equal(state.settings.operator, 'Operador PG');
});

test('PG: escrituras simultáneas se serializan y ninguna se pierde', { skip }, async () => {
  const runs = 12;
  await Promise.all(
    Array.from({ length: runs }, () =>
      asCompany('co-nueva', () =>
        repo.transaction(async (s) => {
          const n = Number(s.settings.company.replace(/\D/g, '')) || 0;
          // Una espera obliga a que las demás transacciones esperen el bloqueo de fila.
          await new Promise((resolve) => setTimeout(resolve, 5));
          s.settings.company = `Contador ${n + 1}`;
        }),
      ),
    ),
  );
  const state = await asCompany('co-nueva', () => repo.load());
  assert.equal(state.settings.company, `Contador ${runs}`);
});

test('PG: las empresas están aisladas entre sí', { skip }, async () => {
  const a = await asCompany('co-innovamf', () => repo.load());
  const b = await asCompany('co-nueva', () => repo.load());
  assert.notEqual(a.settings.company, b.settings.company);
  assert.equal(b.products.length, 0);
});

test('PG: guarda una copia diaria del estado anterior', { skip }, async () => {
  const rows = await pool.query("SELECT company_id FROM app_state_backup WHERE day = CURRENT_DATE ORDER BY company_id");
  assert.deepEqual(
    rows.rows.map((r) => r.company_id),
    ['co-innovamf', 'co-nueva'],
  );
});

test('PG: reset vuelve al estado inicial', { skip }, async () => {
  const state = await asCompany('co-nueva', () => repo.reset());
  assert.equal(state.products.length, 0);
  assert.notEqual(state.settings.company, 'Contador 12');
});
