import { refreshPurchase } from './purchase-lines.js';
import type { AppState, Lot, PurchaseLine, Receipt } from './types.js';

const OPENING_NOTE = 'Stock inicial · ';

function day(value?: string) {
  return value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : '';
}

/** Unidades que ya salieron de ese lote en pedidos preparados o entregados. */
function consumedFromLot(s: AppState, lot: Lot) {
  let qty = 0;
  for (const order of s.orders) {
    for (const pick of order.picks ?? []) {
      if (pick.productId === lot.productId && pick.batch === lot.batch && pick.loc === lot.loc) qty += pick.qty;
    }
  }
  return qty;
}

/**
 * El ejemplo deja mercancía ya ubicada. Cada lote con stock necesita la recepción
 * que lo ingresó y la orden de compra recibida, para que Ubicaciones, Lotes y
 * Entradas cuenten la misma historia.
 */
export function linkOpeningReceipts(s: AppState) {
  if (s.demo === false) return;
  if (!s.receipts) s.receipts = [];
  if (!s.purchases) s.purchases = [];

  const receiptFor = (lot: Lot) =>
    s.receipts.find((r) => r.lotId === lot.id || r.id === lot.receiptId) ??
    s.receipts.find(
      (r) =>
        r.productId === lot.productId &&
        r.batch === lot.batch &&
        !r.lotId &&
        !s.lots.some((other) => other.id !== lot.id && other.receiptId === r.id),
    );

  let receiptSeq = s.receipts.reduce((n, r) => Math.max(n, Number(r.id.replace(/\D/g, '')) || 0), 0);
  for (const lot of s.lots) {
    if (lot.qty <= 0 && consumedFromLot(s, lot) <= 0) continue;
    const item = s.products.find((p) => p.id === lot.productId);
    const arrived = lot.qty + consumedFromLot(s, lot);
    let receipt = receiptFor(lot);
    if (!receipt) {
      receiptSeq += 1;
      const date = day(lot.receivedAt) || '2026-01-15';
      receipt = {
        id: `REC-${String(receiptSeq).padStart(4, '0')}`,
        supplier: item?.supplier || '',
        date,
        productId: lot.productId,
        qty: arrived,
        loc: lot.loc,
        batch: lot.batch,
        expiry: lot.expiry || undefined,
        receivedAt: lot.receivedAt || `${date}T12:00:00.000Z`,
        by: s.settings.operator || 'Sistema',
        lotId: lot.id,
      };
      s.receipts.push(receipt);
    }
    receipt.lotId = lot.id;
    lot.receiptId = receipt.id;
    if (!receipt.supplier && item?.supplier) receipt.supplier = item.supplier;
    if (!receipt.expiry && lot.expiry) receipt.expiry = lot.expiry;
    if (!receipt.receivedAt) receipt.receivedAt = lot.receivedAt || `${receipt.date}T12:00:00.000Z`;
    if (receipt.qty < arrived) receipt.qty = arrived;
  }

  const loose = s.receipts.filter((r) => r.lotId && !r.purchaseId && !r.reason);
  const bySupplier = new Map<string, Receipt[]>();
  for (const receipt of loose) {
    const name = receipt.supplier || 'Sin proveedor';
    const list = bySupplier.get(name) ?? [];
    list.push(receipt);
    bySupplier.set(name, list);
  }

  let purchaseSeq = s.purchases.reduce((n, p) => Math.max(n, Number(p.id.replace(/\D/g, '')) || 0), 0);
  for (const [name, receipts] of bySupplier) {
    const note = `${OPENING_NOTE}${name}`;
    let po = s.purchases.find((p) => p.notes === note);
    if (!po) {
      purchaseSeq += 1;
      const lines = new Map<string, PurchaseLine>();
      for (const receipt of receipts) {
        const item = s.products.find((p) => p.id === receipt.productId);
        const cost = item?.avgCost && item.avgCost > 0 ? item.avgCost : Math.round((item?.price ?? 0) * 0.62 * 100) / 100;
        const line = lines.get(receipt.productId) ?? {
          productId: receipt.productId,
          qty: 0,
          packCode: 'unidad',
          unitsPerPack: 1,
          unitPrice: cost,
          receivedUnits: 0,
        };
        line.qty += receipt.qty;
        line.receivedUnits = (line.receivedUnits ?? 0) + receipt.qty;
        lines.set(receipt.productId, line);
      }
      const built = [...lines.values()];
      po = refreshPurchase({
        id: `OC-${String(purchaseSeq).padStart(4, '0')}`,
        supplierId: s.suppliers?.find((supplier) => supplier.name.toLowerCase() === name.toLowerCase())?.id,
        productId: built[0]?.productId ?? '',
        qty: 0,
        date: receipts.map((r) => r.date).sort()[0] ?? '2026-01-15',
        notes: note,
        received: 0,
        status: 'Recibida',
        lines: built,
      });
      s.purchases.push(po);
    }
    for (const receipt of receipts) {
      receipt.purchaseId = po.id;
      const lot = s.lots.find((item) => item.id === receipt.lotId);
      if (lot) lot.purchaseId = po.id;
    }
  }

  for (const po of s.purchases) {
    if (po.supplierId || !po.notes?.startsWith(OPENING_NOTE)) continue;
    const name = po.notes.slice(OPENING_NOTE.length);
    po.supplierId = s.suppliers?.find((supplier) => supplier.name.toLowerCase() === name.toLowerCase())?.id;
  }
}
