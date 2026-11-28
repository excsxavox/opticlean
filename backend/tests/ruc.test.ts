import test from 'node:test';
import assert from 'node:assert/strict';
import { assertRuc, isValidEcuadorRuc } from '../src/domain/ruc.js';
import { createClient } from '../src/domain/commerce.service.js';
import { seed } from '../src/domain/seed.js';
import { migrateState } from '../src/domain/state-migrate.js';

test('RUC: persona natural, sociedad privada y entidad pública válidas', () => {
  assert.equal(isValidEcuadorRuc('1710034065001'), true);
  assert.equal(isValidEcuadorRuc('1790012344001'), true);
  assert.equal(isValidEcuadorRuc('1760000070001'), true);
});

test('RUC: rechaza dígito verificador, provincia, tipo y establecimiento inválidos', () => {
  assert.equal(isValidEcuadorRuc('1710034066001'), false, 'verificador de cédula');
  assert.equal(isValidEcuadorRuc('1790012345001'), false, 'verificador de sociedad');
  assert.equal(isValidEcuadorRuc('9910034065001'), false, 'provincia');
  assert.equal(isValidEcuadorRuc('1770034065001'), false, 'tercer dígito 7');
  assert.equal(isValidEcuadorRuc('1710034065000'), false, 'establecimiento 000');
  assert.equal(isValidEcuadorRuc('171003406500'), false, '12 dígitos');
  assert.equal(isValidEcuadorRuc(''), false);
  assert.equal(isValidEcuadorRuc(undefined), false);
});

test('RUC: el dígito verificador se exige solo en modo estricto', () => {
  const prev = process.env.OPTICLEAN_STRICT_RUC;
  try {
    process.env.OPTICLEAN_STRICT_RUC = '0';
    assert.doesNotThrow(() => assertRuc('1790000000001'));
    assert.throws(() => assertRuc('12345'), /13 dígitos/);
    process.env.OPTICLEAN_STRICT_RUC = '1';
    assert.throws(() => assertRuc('1790000000001'), /dígito verificador/);
    assert.doesNotThrow(() => assertRuc('1710034065001'));
    // Una ficha existente no se bloquea mientras no cambie su RUC.
    assert.doesNotThrow(() => assertRuc('1790000000001', 'RUC', '1790000000001'));
  } finally {
    if (prev === undefined) delete process.env.OPTICLEAN_STRICT_RUC;
    else process.env.OPTICLEAN_STRICT_RUC = prev;
  }
});

test('RUC: crear cliente en modo estricto rechaza un RUC inválido', () => {
  const prev = process.env.OPTICLEAN_STRICT_RUC;
  try {
    process.env.OPTICLEAN_STRICT_RUC = '1';
    const s = migrateState(seed());
    const base = {
      name: 'Cliente RUC',
      contact: 'Ana',
      address: 'Calle 1',
      email: 'ana@cliente.com',
      type: 'Oficina',
    };
    assert.throws(() => createClient(s, { ...base, taxId: '1790000000001' }), /dígito verificador/);
    const ok = createClient(s, { ...base, taxId: '1710034065001' });
    assert.equal(ok.taxId, '1710034065001');
  } finally {
    if (prev === undefined) delete process.env.OPTICLEAN_STRICT_RUC;
    else process.env.OPTICLEAN_STRICT_RUC = prev;
  }
});
