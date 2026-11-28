import test from 'node:test';
import assert from 'node:assert/strict';
import { seed } from '../src/domain/seed.js';
import { migrateState } from '../src/domain/state-migrate.js';
import { createOrder, dispatch, prepare, upsertProduct } from '../src/domain/inventory.service.js';
import { issueGuide } from '../src/domain/commercial.service.js';
import {
  cleanPackingBoxes,
  confirmLoad,
  countUnits,
  createParcel,
  expectedWeight,
  scanUnit,
  updateParcel,
} from '../src/domain/packing.service.js';
import {
  CODE128_PATTERNS,
  code128Values,
  packingListPdf,
  parcelLabelsPdf,
} from '../src/domain/packing-documents.js';
import type { AppState } from '../src/domain/types.js';
import { packAll } from './helpers/pack.js';

const fresh = () => migrateState(seed());

function prepared(s: AppState, lines: Array<{ productId: string; qty: number }>) {
  const order = createOrder(s, { clientId: 'CL001', lines });
  prepare(s, order.id);
  return order;
}

test('Conteo: se guarda en el pedido y no pasa de lo preparado', () => {
  const s = fresh();
  const order = prepared(s, [{ productId: 'P001', qty: 3 }]);
  const pick = order.picks![0];
  const key = `${pick.productId}|${pick.batch}`;
  countUnits(s, order.id, { productId: pick.productId, batch: pick.batch, qty: 2 });
  assert.equal(order.packCounts![key], 2);
  assert.throws(() => countUnits(s, order.id, { productId: pick.productId, batch: pick.batch, qty: 99 }), /entre 0/);
  assert.throws(() => countUnits(s, order.id, { productId: 'P012', qty: 1 }), /no está en este pedido/);
});

test('Escáner: cada lectura suma una unidad por código de barras, SKU o id', () => {
  const s = fresh();
  s.products.find((p) => p.id === 'P001')!.barcode = '7861234567890';
  const order = prepared(s, [{ productId: 'P001', qty: 2 }]);
  const total = () => Object.values(order.packCounts ?? {}).reduce((n, v) => n + v, 0);
  scanUnit(s, order.id, ' 7861234567890 ');
  scanUnit(s, order.id, 'p001');
  assert.equal(total(), 2);
  assert.throws(() => scanUnit(s, order.id, 'P001'), /ya está completo/);
  assert.throws(() => scanUnit(s, order.id, '0000000000000'), /No hay ningún producto/);
  assert.throws(() => scanUnit(s, order.id, 'P012'), /no está en este pedido/);
  assert.equal(total(), 2);
});

test('Escáner: lo que ya está en un bulto no se vuelve a contar', () => {
  const s = fresh();
  const order = prepared(s, [{ productId: 'P001', qty: 2 }]);
  const pick = order.picks![0];
  const parcel = createParcel(s, { orderId: order.id });
  updateParcel(s, parcel.id, { contents: [{ productId: 'P001', batch: pick.batch!, qty: 1 }] });
  scanUnit(s, order.id, 'P001');
  assert.equal(order.packCounts![`P001|${pick.batch}`], 2);
});

test('Código de barras: no se repite entre productos y se puede borrar', () => {
  const s = fresh();
  const [a, b] = s.products;
  upsertProduct(s, { ...a, barcode: '111' }, a.id);
  assert.throws(() => upsertProduct(s, { ...b, barcode: '111' }, b.id), /ya lo usa/);
  upsertProduct(s, { ...s.products.find((p) => p.id === a.id)!, barcode: '' }, a.id);
  assert.equal(s.products.find((p) => p.id === a.id)!.barcode, undefined);
});

test('Cajas: el catálogo se valida y un cambio no altera bultos ya armados', () => {
  const s = fresh();
  assert.throws(() => cleanPackingBoxes([]), /al menos un/);
  assert.throws(() => cleanPackingBoxes([{ code: 'custom', label: 'x', dims: { l: 1, w: 1, h: 1 }, tareKg: 0 }]), /reservado/);
  assert.throws(() => cleanPackingBoxes([{ code: 'A', label: 'A', dims: { l: 0, w: 1, h: 1 }, tareKg: 0 }]), /centímetros/);
  const mine = { code: 'A', label: 'Caja azul', dims: { l: 50, w: 40, h: 20 }, tareKg: 1 };
  s.settings.packingBoxes = cleanPackingBoxes([mine]);
  const order = prepared(s, [{ productId: 'P001', qty: 1 }]);
  assert.throws(() => createParcel(s, { orderId: order.id, boxCode: 'M' }), /desconocido/);
  const parcel = createParcel(s, { orderId: order.id, boxCode: 'A' });
  assert.equal(parcel.volumeM3, 0.04);
  const before = expectedWeight(s, parcel);
  s.settings.packingBoxes = cleanPackingBoxes([{ ...mine, tareKg: 5 }]);
  assert.equal(expectedWeight(s, parcel), before);
});

test('Guía de remisión: lleva los bultos, también si se emitió antes de empacar', () => {
  const s = fresh();
  const order = prepared(s, [{ productId: 'P001', qty: 2 }]);
  const early = issueGuide(s, { orderId: order.id });
  assert.equal(early.packages, undefined);
  packAll(s, order.id);
  dispatch(s, [order.id], 'GBA-2041');
  const guide = s.guides!.find((g) => g.orderId === order.id)!;
  assert.equal(guide.id, early.id);
  assert.equal(guide.packages!.count, 1);
  assert.ok(guide.packages!.weightKg > 0);
  assert.equal(guide.plate, 'GBA-2041');
});

test('Code 128: la tabla cumple las propiedades de la simbología', () => {
  assert.equal(CODE128_PATTERNS.length, 107);
  assert.equal(new Set(CODE128_PATTERNS).size, 107);
  CODE128_PATTERNS.slice(0, 106).forEach((pattern, value) => {
    const widths = [...pattern].map(Number);
    assert.equal(widths.length, 6, `símbolo ${value}`);
    assert.equal(widths.reduce((a, b) => a + b, 0), 11, `símbolo ${value} mide 11 módulos`);
    assert.equal((widths[0] + widths[2] + widths[4]) % 2, 0, `símbolo ${value}: las barras suman par`);
  });
  assert.equal(CODE128_PATTERNS[106], '2331112');
  // Ejemplo calculado a mano: "AB" → inicio 104, 33, 34, control (104+33+68)%103 = 102, parada.
  assert.deepEqual(code128Values('AB'), [104, 33, 34, 102, 106]);
});

/** Reconstruye el texto a partir de las barras dibujadas en la primera etiqueta. */
function decodeBars(pdf: string) {
  const page = pdf.slice(pdf.indexOf('stream\n'), pdf.indexOf('endstream'));
  const bars = [...page.matchAll(/^([\d.]+) 40 ([\d.]+) 56 re f$/gm)].map((m) => [Number(m[1]), Number(m[2])]);
  const unit = Math.min(...bars.map((bar) => bar[1]));
  const widths: number[] = [];
  bars.forEach(([x, width], index) => {
    widths.push(Math.round(width / unit));
    const next = bars[index + 1];
    if (next) widths.push(Math.round((next[0] - x - width) / unit));
  });
  const stream = widths.join('');
  const values: number[] = [];
  for (let at = 0; at < stream.length - 7; at += 6) values.push(CODE128_PATTERNS.indexOf(stream.slice(at, at + 6)));
  assert.equal(stream.slice(-7), CODE128_PATTERNS[106]);
  return values.slice(1, -1).map((v) => String.fromCharCode(v + 32)).join('');
}

test('Etiquetas y lista: exigen empaque cerrado, una etiqueta por bulto y el código se lee', () => {
  const s = fresh();
  const order = prepared(s, [
    { productId: 'P001', qty: 2 },
    { productId: 'P012', qty: 1 },
  ]);
  assert.throws(() => parcelLabelsPdf(s, order.id), /Cierra el empaque/);
  packAll(s, order.id);
  const parcels = s.parcels!.filter((p) => p.orderId === order.id);
  confirmLoad(s, { plate: 'GBA-2041', orderIds: [order.id] });
  const labels = parcelLabelsPdf(s, order.id).buffer.toString('latin1');
  assert.ok(labels.startsWith('%PDF-1.4'));
  assert.equal(labels.match(/\/Type \/Page /g)!.length, parcels.length);
  assert.ok(labels.includes(`Bulto 1 de ${parcels.length}`));
  assert.ok(labels.includes('Parada 1'));
  assert.equal(decodeBars(labels), parcels[0].id);
  const list = packingListPdf(s, order.id).buffer.toString('latin1');
  assert.ok(list.includes(`Lista de empaque · ${order.id}`));
  assert.ok(list.includes(`Total: ${parcels.length} bulto`));
  // La tabla de referencias del PDF apunta a cada objeto.
  const xref = Number(list.match(/startxref\n(\d+)/)![1]);
  assert.equal(list.slice(xref, xref + 4), 'xref');
  const offsets = [...list.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  offsets.forEach((offset, i) => assert.ok(list.slice(offset).startsWith(`${i + 1} 0 obj`)));
});

test('Lista de empaque larga: reparte en varias páginas', () => {
  const s = fresh();
  const order = prepared(s, [{ productId: 'P001', qty: 1 }]);
  packAll(s, order.id);
  const [base] = s.parcels!.filter((p) => p.orderId === order.id);
  for (let i = 0; i < 20; i += 1) s.parcels!.push({ ...base, id: `BUL-9${String(i).padStart(3, '0')}` });
  const list = packingListPdf(s, order.id).buffer.toString('latin1');
  assert.ok(list.match(/\/Type \/Page /g)!.length >= 2);
});
