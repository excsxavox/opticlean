import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { seed } from '../src/domain/seed.js';
import { createOrder, prepare, dispatch, confirmDelivery } from '../src/domain/inventory.service.js';
import { cancelOrder, updateClient, receivePurchase } from '../src/domain/commerce.service.js';
import { commitImport, previewXml } from '../src/domain/import-docs.service.js';
import { issueCreditNote, issueInvoice } from '../src/domain/commercial.service.js';
import { packAll } from './helpers/pack.js';
import { cellFits, unitsAt } from '../src/domain/capacity.js';
import { getWarehouseGeometry } from '../src/domain/warehouse-layout.js';

const xml = readFileSync(resolve('..', 'samples', 'facturas', 'factura-prueba-opticlean.xml'), 'utf8');

test('Una factura de otro sistema llega al cliente y el dinero cuadra en cada caso', () => {
  const s = seed();
  const preview = previewXml(s, xml, 'sale');
  assert.equal(preview.partyName, 'Hotel Alameda S.A.');
  assert.equal(preview.rows.length, 3);
  assert.equal(preview.warnings.length, 0);

  const imported = commitImport(s, { ...preview, kind: 'sale' });
  const original = s.orders.find((order) => order.id === imported.orderId);
  assert.ok(original);
  assert.equal(original.status, 'Por preparar');
  const buyer = s.clients.find((client) => client.id === original.clientId);
  assert.equal(buyer?.taxId, '1790012345001');

  updateClient(s, buyer!.id, {
    ...buyer!,
    address: 'Av. República E7-123, Quito',
    phone: '0225550101',
  });
  cancelOrder(s, original.id, 'El cliente cambió la dirección y pidió menos cantidad.');
  assert.equal(original.status, 'Cancelado');

  const changed = createOrder(s, {
    clientId: buyer!.id,
    lines: original.lines.map((line) => ({
      productId: line.productId,
      qty: line.productId === 'P001' ? Math.max(1, Math.floor(line.qty / 2)) : line.qty,
    })),
    notes: `Cambio de ${original.id}. Importado ${preview.docNumber}`,
  });
  assert.equal(changed.lines.find((line) => line.productId === 'P001')?.qty, 6);
  assert.equal(changed.status, 'Por preparar');

  prepare(s, changed.id);
  packAll(s, changed.id);
  dispatch(s, [changed.id], 'AMB-5520');
  assert.equal(changed.status, 'En ruta');
  assert.ok(changed.deliveryCode);
  confirmDelivery(s, changed.id, 'Recepción del hotel', 'Llegó completo a la nueva dirección', changed.deliveryCode);
  assert.equal(changed.status, 'Entregado');

  const invoice = issueInvoice(s, changed.id);
  assert.equal(invoice.status, 'Emitida');
  assert.ok(invoice.subtotal > 0);
  const missing = invoice.lines[0];
  const claim = issueCreditNote(s, {
    invoiceId: invoice.id,
    reason: 'El cliente no recibió esta unidad.',
    lines: [{ productId: missing.productId, qty: 1, batch: missing.batch }],
  });
  assert.equal(claim.status, 'Emitida');
  assert.ok(claim.subtotal < invoice.subtotal);

  const purchasePreview = previewXml(s, xml, 'purchase');
  const purchaseImport = commitImport(s, { ...purchasePreview, kind: 'purchase' });
  const purchase = s.purchases.find((item) => item.id === purchaseImport.purchaseId);
  assert.ok(purchase);
  const line = purchase.lines![0];
  const spot = getWarehouseGeometry(s).locations.find(
    (loc) => unitsAt(s, loc.id) === 0 && cellFits(s, loc, line.productId, 2),
  );
  assert.ok(spot, 'No hay ubicación libre para recibir una parte.');
  receivePurchase(s, purchase.id, {
    lines: [
      {
        productId: line.productId,
        qty: 2,
        loc: spot.id,
        batch: line.batch || 'LT-PARCIAL',
        expiry: line.expiry || '2027-06-30',
      },
    ],
  });
  assert.equal(purchase.status, 'Parcial');
  assert.ok((line.receivedUnits ?? 0) > 0);
  assert.ok((line.receivedUnits ?? 0) < (line.qty ?? line.units ?? 0) * Math.max(1, line.unitsPerPack || 1));

  const sold = invoice.subtotal - claim.subtotal;
  const bought = purchase.lines!.reduce((sum, item) => {
    const perUnit = item.unitsPerPack > 0 ? item.unitPrice / item.unitsPerPack : item.unitPrice;
    return sum + (item.receivedUnits ?? 0) * perUnit;
  }, 0);
  assert.ok(sold > 0);
  assert.ok(bought > 0);
  assert.equal(s.invoices?.some((item) => item.orderId === original.id), false);
});
