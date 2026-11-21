import type { AppState, HazardClass, Product, ProductPack, Purchase } from '../types';
import { lotsForScope, product, scopedLots } from './inventory';

export const HAZARD_LABEL: Record<HazardClass, string> = {
  none: 'Sin riesgo químico',
  acid: 'Ácido',
  base: 'Base / alcalino',
  oxidizer: 'Oxidante',
  flammable: 'Inflamable',
  chlorinated: 'Clorado',
  aerosol: 'Aerosol',
};

export const HAZARD_OPTIONS = Object.entries(HAZARD_LABEL) as Array<[HazardClass, string]>;

const FALLBACK_PACKS: ProductPack[] = [
  { code: 'unidad', label: 'Unidad', units: 1 },
  { code: 'paquete', label: 'Paquete', units: 6 },
  { code: 'caja', label: 'Caja', units: 12 },
  { code: 'bulto', label: 'Bulto', units: 48 },
];

export function packsOf(item?: Pick<Product, 'packs'>): ProductPack[] {
  const packs = item?.packs?.filter((pack) => pack.code && pack.units > 0);
  return packs?.length ? packs : FALLBACK_PACKS;
}

export function purchaseLines(po: Purchase) {
  if (po.lines?.length) return po.lines;
  return [
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

export function pendingUnits(po: Purchase, productId?: string) {
  return purchaseLines(po)
    .filter((line) => !productId || line.productId === productId)
    .reduce((n, line) => n + line.qty * line.unitsPerPack - (line.receivedUnits ?? 0), 0);
}

export function purchaseIncludes(po: Purchase, productId: string) {
  return purchaseLines(po).some((line) => line.productId === productId);
}

export type ExpiryAlert = {
  lotId: string;
  productId: string;
  name: string;
  loc: string;
  expiry: string;
  days: number;
  band: 'vencido' | '30' | '60' | '90';
};

export function expiryAlerts(state: AppState, warehouseId?: string | 'all'): ExpiryAlert[] {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guayaquil' });
  const todayMs = Date.parse(`${today}T12:00:00Z`);
  const alerts: ExpiryAlert[] = [];
  const lots = warehouseId ? lotsForScope(state, warehouseId) : scopedLots(state);
  for (const lot of lots) {
    if (lot.qty <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(lot.expiry)) continue;
    const days = Math.round((Date.parse(`${lot.expiry}T12:00:00Z`) - todayMs) / 864e5);
    const band = days < 0 ? 'vencido' : days <= 30 ? '30' : days <= 60 ? '60' : days <= 90 ? '90' : null;
    if (!band) continue;
    alerts.push({
      lotId: lot.id,
      productId: lot.productId,
      name: product(state, lot.productId)?.name ?? lot.productId,
      loc: lot.loc,
      expiry: lot.expiry,
      days,
      band,
    });
  }
  return alerts.sort((a, b) => a.days - b.days);
}
