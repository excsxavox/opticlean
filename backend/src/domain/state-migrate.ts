import { seed } from './seed.js';
import { ensureFamilies } from './families.service.js';
import { ensureVehicles } from './fleet.service.js';
import { ensureBundles } from './bundles.service.js';
import { inferHazard, isHazardClass } from './hazard.js';
import { defaultPacksFor } from './packs.js';
import { refreshPurchase } from './purchase-lines.js';
import { ensureSuppliers } from './suppliers.service.js';
import { ensureCommercial } from './commercial.service.js';
import { ensureOutbound } from './outbound.service.js';
import { linkOpeningReceipts } from './opening-stock.js';
import type { AppState } from './types.js';
import { mergeBusinessRules } from './business-rules.js';
import { DEFAULT_WAREHOUSE_ID, syncSettingsWarehouseLabel } from './warehouse-admin.service.js';
import {
  DEFAULT_LAYOUT,
  isSingleFaceLocId,
  normalizeLayout,
  toDelanteraLocId,
} from './warehouse-layout.js';

function remapWarehouseLocationRefs(base: AppState, warehouseId: string) {
  const touch = (loc: string | undefined) => {
    if (!loc || !isSingleFaceLocId(loc)) return loc;
    return toDelanteraLocId(loc);
  };

  for (const lot of base.lots) {
    if ((lot.warehouseId ?? DEFAULT_WAREHOUSE_ID) === warehouseId) {
      lot.loc = touch(lot.loc) ?? lot.loc;
    }
  }
  for (const ev of base.events) {
    ev.from = touch(ev.from) ?? ev.from;
    ev.to = touch(ev.to) ?? ev.to;
  }
  for (const o of base.orders) {
    for (const p of o.picks ?? []) {
      if (p.loc) p.loc = touch(p.loc) ?? p.loc;
    }
  }
  for (const r of base.receipts ?? []) {
    r.loc = touch(r.loc) ?? r.loc;
  }
}

function applyQuitoDualDepth(base: AppState) {
  const qt = base.warehouses.find((w) => w.id === DEFAULT_WAREHOUSE_ID);
  if (!qt) return;
  qt.layout = normalizeLayout({ ...qt.layout, ...DEFAULT_LAYOUT, depthFaces: 2 });
  qt.racks = qt.layout.rackCount;
  qt.notes = 'Layout 3D con doble profundidad (144 posiciones).';
  remapWarehouseLocationRefs(base, DEFAULT_WAREHOUSE_ID);
}

export function migrateState(raw: AppState): AppState {
  const base = raw;
  if (!base.warehouses?.length) {
    base.warehouses = seed().warehouses;
  }
  if (!base.settings.activeWarehouseId) {
    base.settings.activeWarehouseId = DEFAULT_WAREHOUSE_ID;
  }
  for (const lot of base.lots) {
    if (!lot.warehouseId) lot.warehouseId = DEFAULT_WAREHOUSE_ID;
    if (!lot.receivedAt) {
      const receipt = base.receipts?.find(
        (r) => r.productId === lot.productId && r.batch === lot.batch && /^\d{4}-\d{2}-\d{2}/.test(r.date),
      );
      lot.receivedAt = receipt?.date?.slice(0, 10) || lot.expiry?.slice(0, 10) || undefined;
    }
  }
  for (const w of base.warehouses) {
    w.layout = normalizeLayout({ racks: w.racks ?? DEFAULT_LAYOUT.rackCount, ...w.layout });
    w.racks = w.layout.rackCount;
  }

  if (base.version === 1) {
    applyQuitoDualDepth(base);
    base.version = 2;
  }

  // Estructura padre→hijo (BOM): normaliza kind/components; si falta, aporta insumos demo
  for (const p of base.products) {
    p.components = Array.isArray(p.components) ? p.components : [];
    p.kind = p.kind === 'raw' ? 'raw' : 'finished';
  }
  const isDemo = base.demo !== false;
  if (isDemo && !base.products.some((p) => p.kind === 'raw')) {
    const demo = seed();
    const raws = demo.products.filter((p) => p.kind === 'raw');
    const rawLots = demo.lots.filter((l) => raws.some((r) => r.id === l.productId));
    base.products.push(...raws);
    base.lots.push(...rawLots);
    for (const demoP of demo.products) {
      const local = base.products.find((p) => p.id === demoP.id);
      if (local && demoP.components?.length) local.components = [...demoP.components];
    }
  }

  // Historial de demanda para previsión adaptativa (solo si aún no está)
  if (isDemo && !base.orders.some((o) => o.id.startsWith('PED-H'))) {
    const demo = seed();
    const historyOrders = demo.orders.filter((o) => o.id.startsWith('PED-H'));
    const historyEvents = demo.events.filter((e) => e.id.startsWith('ev-h-'));
    base.orders.push(...historyOrders);
    base.events.push(...historyEvents);
  }

  ensureFamilies(base);
  ensureVehicles(base);
  ensureBundles(base);
  const suppliers = ensureSuppliers(base);
  for (const name of [...new Set(base.products.map((p) => p.supplier).filter(Boolean))]) {
    if (!suppliers.some((supplier) => supplier.name.toLowerCase() === name.toLowerCase())) {
      const n = suppliers.reduce((max, supplier) => Math.max(max, Number(supplier.id.replace(/\D/g, '')) || 0), 0) + 1;
      suppliers.push({
        id: `PR-${String(n).padStart(3, '0')}`,
        name,
        taxId: '',
        contact: '',
        email: '',
        phone: '',
        leadTimeDays: 7,
        terms: 'Mayorista',
      });
    }
  }
  for (const po of base.purchases ?? []) {
    po.received ??= 0;
    if (!po.lines?.length && po.productId) {
      po.lines = [
        {
          productId: po.productId,
          qty: po.qty,
          packCode: 'unidad',
          unitsPerPack: 1,
          unitPrice: 0,
          receivedUnits: po.received ?? 0,
        },
      ];
    }
    if (po.lines?.length) refreshPurchase(po);
    else po.status ??= po.received >= po.qty ? 'Recibida' : po.received > 0 ? 'Parcial' : 'Abierta';
  }
  for (const p of base.products) {
    if (p.fragile === undefined) {
      p.fragile = p.category === 'Hospitalaria' || p.kind === 'raw';
    }
    if (!isHazardClass(p.hazardClass)) p.hazardClass = inferHazard(p.name, p.id);
    if (!p.packs?.length) p.packs = defaultPacksFor(p.name);
    if (!p.stockUnit) p.stockUnit = p.packs[0]?.label ?? 'unidad';
    if (p.minShelfLifeDays == null || !Number.isFinite(p.minShelfLifeDays)) {
      p.minShelfLifeDays = p.category === 'Hospitalaria' ? 30 : 0;
    }
    // Solo datos demo recién sembrados: costo de referencia para valorar a costo.
    // Datos existentes sin costo no se inventan; el tablero los señala.
    if (base.demo === true && (p.avgCost == null || !(p.avgCost > 0)) && p.price > 0) {
      p.avgCost = Math.round(p.price * 0.62 * 100) / 100;
    }
    if (!p.supplierId && p.supplier) {
      p.supplierId = suppliers.find((supplier) => supplier.name.toLowerCase() === p.supplier.toLowerCase())?.id;
    }
  }
  for (const bundle of base.bundles ?? []) {
    if (bundle.price == null || !Number.isFinite(bundle.price)) {
      bundle.price = bundle.lines.reduce((n, line) => {
        const item = base.products.find((p) => p.id === line.productId);
        return n + line.qty * (item?.price ?? 0);
      }, 0);
    }
  }

  // Límite de crédito por cliente (default según tipo si falta)
  const defaultCreditByType: Record<string, number> = {
    Hotelería: 5000,
    Salud: 8000,
    Corporativo: 12000,
    Restauración: 2500,
    Institucional: 6000,
    Retail: 10000,
    Industrial: 9000,
    Mayorista: 4000,
  };
  const seededCredits = new Map(seed().clients.map((c) => [c.id, c.creditLimit ?? 0]));
  for (const c of base.clients) {
    if (c.creditLimit == null || !Number.isFinite(c.creditLimit)) {
      c.creditLimit =
        seededCredits.get(c.id) ??
        defaultCreditByType[c.type] ??
        3000;
    }
  }

  base.settings.businessRules = mergeBusinessRules(base.settings.businessRules, undefined);
  ensureCommercial(base);

  if (isDemo) {
    const demo = seed();
    const demoOrders = new Map(demo.orders.map((order) => [order.id, order]));
    for (const order of base.orders) {
      const from = demoOrders.get(order.id);
      if (from?.picks?.length && !order.picks?.length) order.picks = from.picks.map((pick) => ({ ...pick }));
    }
    const usedTax = new Set(suppliers.map((supplier) => supplier.taxId).filter((tax) => /^\d{13}$/.test(tax)));
    let taxSeq = 1;
    for (const supplier of suppliers) {
      if (/^\d{13}$/.test(supplier.taxId)) continue;
      let tax = '';
      do {
        tax = `1791${String(taxSeq).padStart(9, '0')}`;
        taxSeq += 1;
      } while (usedTax.has(tax));
      supplier.taxId = tax;
      usedTax.add(tax);
    }
    const demoClients = new Map(demo.clients.map((client) => [client.id, client]));
    for (const client of base.clients) {
      const from = demoClients.get(client.id);
      if (from?.taxId && !client.taxId) client.taxId = from.taxId;
    }
    const demoProducts = new Map(demo.products.map((item) => [item.id, item]));
    for (const item of base.products) {
      const from = demoProducts.get(item.id);
      if (!from) continue;
      if (item.perishable == null && from.perishable != null) item.perishable = from.perishable;
      if (item.requiresSanitary == null && from.requiresSanitary) item.requiresSanitary = true;
      if (!item.sanitaryRegistration && from.sanitaryRegistration) item.sanitaryRegistration = from.sanitaryRegistration;
      if (!item.sanitaryExpires && from.sanitaryExpires) item.sanitaryExpires = from.sanitaryExpires;
    }
  }

  ensureOutbound(base);
  if (isDemo) linkOpeningReceipts(base);
  if (isDemo) {
    for (const vehicle of ensureVehicles(base)) {
      if (!vehicle.fuel) vehicle.fuel = vehicle.maxKg >= 2000 ? 'diesel' : 'gasolina';
      if (!vehicle.kmPerUnit) vehicle.kmPerUnit = vehicle.maxKg >= 2000 ? 4 : 18;
      if (!vehicle.fuelPrice) vehicle.fuelPrice = vehicle.fuel === 'diesel' ? 1.9 : 2.8;
    }
  }
  syncSettingsWarehouseLabel(base);
  return base;
}
