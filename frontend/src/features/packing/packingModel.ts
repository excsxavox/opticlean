import { product } from '../../shared/lib/inventory';
import { resolveBusinessRules } from '../../shared/lib/businessRules';
import type { AppState, HazardClass, Order, PackingBox, Parcel } from '../../shared/types';

/** Cajas de partida; deben coincidir con backend/src/domain/packing.service.ts (el servidor valida). */
const DEFAULT_BOXES: PackingBox[] = [
  { code: 'S', label: 'Caja S', dims: { l: 40, w: 30, h: 30 }, tareKg: 0.4 },
  { code: 'M', label: 'Caja M', dims: { l: 60, w: 40, h: 40 }, tareKg: 0.4 },
  { code: 'G', label: 'Caja G', dims: { l: 80, w: 60, h: 50 }, tareKg: 0.4 },
];

export const boxCatalog = (state: AppState): PackingBox[] =>
  state.settings.packingBoxes?.length ? state.settings.packingBoxes : DEFAULT_BOXES;

/** La caja que se propone al crear un bulto: la mediana del catálogo. */
export function defaultBoxCode(state: AppState) {
  const boxes = [...boxCatalog(state)].sort(
    (a, b) => a.dims.l * a.dims.w * a.dims.h - b.dims.l * b.dims.w * b.dims.h,
  );
  return boxes[Math.floor((boxes.length - 1) / 2)].code;
}

export const HAZARD_TEXT: Partial<Record<HazardClass, string>> = {
  acid: 'Ácido',
  base: 'Base',
  oxidizer: 'Oxidante',
  flammable: 'Inflamable',
  chlorinated: 'Clorado',
  aerosol: 'Aerosol',
};

export type PickLine = {
  key: string;
  productId: string;
  batch: string;
  loc: string;
  qty: number;
};

export const keyOf = (productId: string, batch: string | undefined) => `${productId}|${batch ?? ''}`;

/** Lo preparado, agrupado por producto y lote. */
export function pickLines(order: Order): PickLine[] {
  const map = new Map<string, PickLine>();
  for (const pick of order.picks ?? []) {
    const key = keyOf(pick.productId, pick.batch);
    const current = map.get(key);
    if (current) current.qty += pick.qty;
    else {
      map.set(key, {
        key,
        productId: pick.productId,
        batch: pick.batch ?? '',
        loc: pick.loc ?? '',
        qty: pick.qty,
      });
    }
  }
  return [...map.values()];
}

export const unitsOf = (order: Order) => (order.picks ?? []).reduce((n, pick) => n + pick.qty, 0);

export const parcelsOf = (state: AppState, orderId: string) =>
  (state.parcels ?? []).filter((parcel) => parcel.orderId === orderId);

export function packedQty(parcels: Parcel[], key: string) {
  return parcels.reduce(
    (sum, parcel) =>
      sum +
      (parcel.contents ?? [])
        .filter((line) => keyOf(line.productId, line.batch) === key)
        .reduce((n, line) => n + line.qty, 0),
    0,
  );
}

export function expectedWeight(state: AppState, parcel: Parcel) {
  const content = (parcel.contents ?? []).reduce(
    (sum, line) => sum + line.qty * (product(state, line.productId)?.weight ?? 0),
    0,
  );
  const tare = parcel.tareKg ?? boxCatalog(state).find((box) => box.code === parcel.boxCode)?.tareKg ?? 0;
  return Math.round((content + tare) * 100) / 100;
}

export function weightDiffers(state: AppState, parcel: Parcel) {
  const expected = expectedWeight(state, parcel);
  if (expected <= 0 || !(parcel.weightKg > 0)) return false;
  const tolerance = resolveBusinessRules(state.settings).packTolerancePct / 100;
  return Math.abs(parcel.weightKg - expected) / expected > tolerance + 1e-9;
}

/** Litros de producto dentro del bulto, en m³ (para avisar si no cabe). */
export const contentVolume = (state: AppState, parcel: Parcel) =>
  (parcel.contents ?? []).reduce(
    (sum, line) => sum + line.qty * (product(state, line.productId)?.volume ?? 0),
    0,
  ) / 1000;

export const isFragile = (state: AppState, parcel: Parcel) =>
  (parcel.contents ?? []).some((line) => product(state, line.productId)?.fragile);

export function packingProblems(state: AppState, order: Order): string[] {
  const parcels = parcelsOf(state, order.id);
  if (!parcels.length) return ['Crea al menos un bulto.'];
  const problems: string[] = [];
  if (parcels.some((parcel) => !parcel.contents)) {
    problems.push('Hay bultos sin detalle de contenido: quítalos y vuelve a armarlos.');
  } else if (parcels.some((parcel) => !parcel.contents!.length)) {
    problems.push('Hay un bulto vacío.');
  }
  const missing = pickLines(order).reduce(
    (sum, line) => sum + Math.max(0, line.qty - packedQty(parcels, line.key)),
    0,
  );
  if (missing > 0) problems.push(`Faltan ${missing} unidades por meter en un bulto.`);
  if (parcels.some((parcel) => !(parcel.weightKg > 0))) problems.push('Hay bultos sin pesar.');
  if (parcels.some((parcel) => weightDiffers(state, parcel) && !parcel.weightNote)) {
    problems.push('Hay una diferencia de peso sin motivo.');
  }
  return problems;
}

export type PackStatus = { label: string; tone: string };

export function packStatus(state: AppState, order: Order): PackStatus {
  if (order.stagedPlate) return { label: 'Cargado', tone: 'green' };
  if (order.packing) return { label: 'Empacado', tone: 'blue' };
  if (parcelsOf(state, order.id).length) return { label: 'En empaque', tone: 'amber' };
  return { label: 'Sin empacar', tone: '' };
}

export const kg = (n: number) => n.toLocaleString('es-EC', { maximumFractionDigits: 1 });
export const m3 = (n: number) => n.toLocaleString('es-EC', { maximumFractionDigits: 3 });
