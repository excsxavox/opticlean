import { client, orderWeight, product } from '../../shared/lib/inventory';
import type { AppState, Order } from '../../shared/types';

export type Truck = {
  id: string;
  plate: string;
  label: string;
  city: string;
  driver: string;
  maxKg: number;
  maxM3: number;
  costPerKm: number;
  etaHours: number;
  routeKm: number;
  baseOccupancy: number;
};

export const FLEET: Truck[] = [
  {
    id: 'T01',
    plate: 'GBA-2041',
    label: 'Camión 01',
    city: 'Quito',
    driver: 'Carlos Sur',
    maxKg: 5000,
    maxM3: 20,
    costPerKm: 0.85,
    etaHours: 3.33,
    routeKm: 62,
    baseOccupancy: 0,
  },
  {
    id: 'T02',
    plate: 'GYE-1188',
    label: 'Camión 02',
    city: 'Guayaquil',
    driver: 'María Costa',
    maxKg: 4000,
    maxM3: 16,
    costPerKm: 0.8,
    etaHours: 4.17,
    routeKm: 65,
    baseOccupancy: 60,
  },
  {
    id: 'T03',
    plate: 'CUE-3301',
    label: 'Camión 03',
    city: 'Cuenca',
    driver: 'Luis Andes',
    maxKg: 3000,
    maxM3: 12,
    costPerKm: 0.75,
    etaHours: 3.83,
    routeKm: 65,
    baseOccupancy: 100,
  },
  {
    id: 'T04',
    plate: 'AMB-5520',
    label: 'Camión 04',
    city: 'Santo Domingo',
    driver: 'Ana Rivera',
    maxKg: 4500,
    maxM3: 18,
    costPerKm: 0.78,
    etaHours: 4.08,
    routeKm: 66,
    baseOccupancy: 0,
  },
];

export const ACTIVE_STATUSES = new Set(['Por preparar', 'Preparado', 'En ruta', 'Incidencia']);
export const ROUTE_STATUSES = new Set(['En ruta', 'Incidencia']);

export const orderVolume = (s: AppState, o: Order) =>
  o.lines.reduce((n, l) => n + l.qty * (product(s, l.productId)?.volume ?? 0), 0) / 1000;

export const packagesOf = (o: Order) => o.lines.length;

export const cityOf = (s: AppState, o: Order) => {
  const c = client(s, o.clientId);
  if (c?.city) return c.city;
  if (c?.address.includes('Guayaquil')) return 'Guayaquil';
  if (c?.address.includes('Cuenca')) return 'Cuenca';
  return 'Quito';
};

export const sectorOf = (s: AppState, o: Order) => {
  const c = client(s, o.clientId);
  return c?.sector || c?.address || 'Sin sector';
};

export const fmtHours = (h: number) => {
  const hours = Math.floor(h);
  const mins = Math.round((h - hours) * 60);
  return `${hours}h ${String(mins).padStart(2, '0')}min`;
};

export const statusTone = (status: string) => {
  if (status === 'En ruta') return 'route';
  if (status === 'Incidencia') return 'issue';
  return 'pending';
};

export const statusLabel = (status: string) => {
  if (status === 'En ruta') return 'En ruta';
  if (status === 'Incidencia') return 'Incidencia';
  return 'Pendiente';
};

export function truckLoad(
  s: AppState,
  t: Truck,
  orders: Order[],
  /** Pedidos preparados pendientes de confirmar (vista previa en el camión activo). */
  pending: Order[] = [],
) {
  const truckOrders = orders.filter((o) => o.vehicle === t.plate);
  const pendingOnly = pending.filter(
    (o) => o.status === 'Preparado' && !truckOrders.some((x) => x.id === o.id),
  );
  const all = [...truckOrders, ...pendingOnly];
  const kg = Math.round(all.reduce((n, o) => n + orderWeight(s, o), 0));
  const m3 = Math.round(all.reduce((n, o) => n + orderVolume(s, o), 0) * 10) / 10;
  const pct = Math.max(
    Math.min(100, Math.round((kg / t.maxKg) * 100)),
    Math.min(100, Math.round((m3 / t.maxM3) * 100)),
  );
  const status = pct >= 90 ? 'full' : pct > 0 ? 'partial' : 'ok';
  const label =
    status === 'full' ? 'Lleno' : status === 'partial' ? 'En uso (parcial)' : 'Disponible';
  return {
    orders: truckOrders,
    pending: pendingOnly,
    kg,
    m3,
    pct,
    status,
    label,
    realKg: kg,
    realM3: m3,
  };
}

export function activeOrders(s: AppState) {
  return s.orders.filter((o) => ACTIVE_STATUSES.has(o.status) && !o.id.startsWith('PED-H'));
}

export function routeOrders(s: AppState, plate: string) {
  return s.orders.filter(
    (o) => o.vehicle === plate && ROUTE_STATUSES.has(o.status) && !o.id.startsWith('PED-H'),
  );
}

export type AutoAssignItem = {
  orderId: string;
  truckId: string;
  plate: string;
  truckLabel: string;
  city: string;
  kg: number;
  m3: number;
  reason: string;
};

export type AutoAssignPlan = {
  assignments: AutoAssignItem[];
  byTruck: Record<string, string[]>;
  unassigned: { orderId: string; kg: number; m3: number; city: string; reason: string }[];
  summary: string;
  source?: 'openai' | 'heuristic';
};

/**
 * Heurística tipo IA: prioriza ciudad del camión, capacidad kg/m³ libre,
 * equilibrio de carga y costo/km. No despacha; solo propone staging.
 */
export function suggestAutoAssign(
  s: AppState,
  ready: Order[],
  alreadyStaged: Record<string, string[]> = {},
): AutoAssignPlan {
  const stagedSet = new Set(Object.values(alreadyStaged).flat());
  const candidates = ready
    .filter((o) => o.status === 'Preparado' && !stagedSet.has(o.id) && !o.vehicle)
    .map((o) => ({
      order: o,
      kg: orderWeight(s, o),
      m3: orderVolume(s, o),
      city: cityOf(s, o),
      sector: sectorOf(s, o),
    }))
    .sort((a, b) => b.kg - a.kg || b.m3 - a.m3);

  const used = new Map<string, { kg: number; m3: number; count: number }>();
  for (const t of FLEET) {
    const load = truckLoad(
      s,
      t,
      activeOrders(s),
      (alreadyStaged[t.id] ?? [])
        .map((id) => s.orders.find((o) => o.id === id))
        .filter((o): o is Order => Boolean(o)),
    );
    used.set(t.id, { kg: load.kg, m3: load.m3, count: load.orders.length + load.pending.length });
  }

  const assignments: AutoAssignItem[] = [];
  const byTruck: Record<string, string[]> = {};
  const unassigned: AutoAssignPlan['unassigned'] = [];

  for (const c of candidates) {
    let best: { truck: Truck; score: number; reason: string } | null = null;

    for (const t of FLEET) {
      const cur = used.get(t.id)!;
      const nextKg = cur.kg + c.kg;
      const nextM3 = cur.m3 + c.m3;
      if (nextKg > t.maxKg + 0.01 || nextM3 > t.maxM3 + 0.01) continue;

      const kgFill = nextKg / t.maxKg;
      const m3Fill = nextM3 / t.maxM3;
      const fill = Math.max(kgFill, m3Fill);
      // Preferir llenado útil sin saturar
      const fillScore = fill <= 0.85 ? fill * 40 : fill <= 0.95 ? 28 : 10;
      const cityScore = t.city === c.city ? 100 : t.city.includes(c.city) || c.city.includes(t.city) ? 40 : 0;
      const costScore = (1.2 - t.costPerKm) * 25;
      const balanceScore = Math.max(0, 18 - cur.count * 2);
      const spareScore = ((t.maxKg - nextKg) / t.maxKg) * 8;
      const score = cityScore + fillScore + costScore + balanceScore + spareScore;

      const reasonParts = [
        cityScore >= 100 ? `misma ciudad (${t.city})` : cityScore > 0 ? `ciudad cercana` : `capacidad libre`,
        `${Math.round(c.kg)} kg / ${c.m3.toFixed(1)} m³ caben`,
        `costo $${t.costPerKm}/km`,
        `ocupación → ${Math.round(fill * 100)}%`,
      ];

      if (!best || score > best.score) {
        best = { truck: t, score, reason: reasonParts.join(' · ') };
      }
    }

    if (!best) {
      unassigned.push({
        orderId: c.order.id,
        kg: Math.round(c.kg),
        m3: Math.round(c.m3 * 10) / 10,
        city: c.city,
        reason: 'Sin capacidad kg/m³ en la flota disponible',
      });
      continue;
    }

    const cur = used.get(best.truck.id)!;
    used.set(best.truck.id, {
      kg: cur.kg + c.kg,
      m3: cur.m3 + c.m3,
      count: cur.count + 1,
    });
    byTruck[best.truck.id] = [...(byTruck[best.truck.id] ?? []), c.order.id];
    assignments.push({
      orderId: c.order.id,
      truckId: best.truck.id,
      plate: best.truck.plate,
      truckLabel: best.truck.label,
      city: best.truck.city,
      kg: Math.round(c.kg),
      m3: Math.round(c.m3 * 10) / 10,
      reason: best.reason,
    });
  }

  const truckCount = Object.keys(byTruck).length;
  const summary =
    assignments.length === 0
      ? 'No hay pedidos listos para asignar o la flota no tiene capacidad.'
      : `IA asignó ${assignments.length} pedido(s) en ${truckCount} camión(es)` +
        (unassigned.length ? `; ${unassigned.length} sin cupo.` : '.');

  return { assignments, byTruck, unassigned, summary };
}

/** Coordenadas geográficas aproximadas por ciudad/sector (OpenStreetMap / Leaflet). */
export function stopGeo(s: AppState, o: Order, index = 0) {
  const city = cityOf(s, o);
  const sector = sectorOf(s, o);
  const bases: Record<string, { lat: number; lng: number }> = {
    Quito: { lat: -0.1807, lng: -78.4678 },
    Guayaquil: { lat: -2.1709, lng: -79.9224 },
    Cuenca: { lat: -2.9001, lng: -79.0059 },
    Ambato: { lat: -1.2417, lng: -78.6198 },
    'Santo Domingo': { lat: -0.2532, lng: -79.1754 },
  };
  const sectorOffset: Record<string, { lat: number; lng: number }> = {
    'Centro Histórico': { lat: -0.01, lng: 0.005 },
    'La Mariscal': { lat: 0.012, lng: -0.004 },
    Cumbayá: { lat: 0.005, lng: 0.045 },
    Tumbaco: { lat: 0.002, lng: 0.06 },
    Carcelén: { lat: 0.055, lng: -0.01 },
    'La Floresta': { lat: -0.008, lng: 0.012 },
    Centro: { lat: 0.004, lng: -0.008 },
    Urdesa: { lat: 0.018, lng: -0.02 },
    Norte: { lat: 0.03, lng: -0.005 },
    'El Centro': { lat: 0.004, lng: -0.006 },
    Yanuncay: { lat: -0.02, lng: 0.012 },
  };
  const base = bases[city] ?? bases.Quito;
  const offset = sectorOffset[sector] ?? {
    lat: ((index % 3) - 1) * 0.008,
    lng: Math.floor(index / 3) * 0.008,
  };
  return {
    lat: base.lat + offset.lat,
    lng: base.lng + offset.lng,
    city,
    sector,
  };
}

/** Bodega / punto de partida aproximado por ciudad de camión. */
export function depotGeo(city: string) {
  const depots: Record<string, { lat: number; lng: number }> = {
    Quito: { lat: -0.205, lng: -78.49 },
    Guayaquil: { lat: -2.19, lng: -79.9 },
    Cuenca: { lat: -2.88, lng: -79.02 },
    Ambato: { lat: -1.25, lng: -78.63 },
    'Santo Domingo': { lat: -0.26, lng: -79.19 },
  };
  return depots[city] ?? depots.Quito;
}

export type RouteHistoryEntry = {
  id: string;
  date: string;
  truckId: string;
  plate: string;
  label: string;
  city: string;
  warehouseId: string;
  warehouseName: string;
  stops: number;
  delivered: number;
  kg: number;
  km: number;
  cost: number;
  etaHours: number;
  status: 'Completada' | 'Parcial' | 'Incidencia';
};

export function buildRouteHistory(s: AppState): RouteHistoryEntry[] {
  const wh = s.warehouses[0];
  const delivered = s.orders.filter((o) => o.status === 'Entregado' && !o.id.startsWith('PED-H'));
  const demo: RouteHistoryEntry[] = [
    {
      id: 'RH-1027-T01',
      date: '2026-10-27',
      truckId: 'T01',
      plate: 'GBA-2041',
      label: 'Camión 01',
      city: 'Quito',
      warehouseId: wh?.id ?? 'WH-QT-01',
      warehouseName: wh?.name ?? 'Bodega Quito',
      stops: 4,
      delivered: 4,
      kg: 420,
      km: 62,
      cost: 52.7,
      etaHours: 3.33,
      status: 'Completada',
    },
    {
      id: 'RH-1026-T02',
      date: '2026-10-26',
      truckId: 'T02',
      plate: 'GYE-1188',
      label: 'Camión 02',
      city: 'Guayaquil',
      warehouseId: s.warehouses.find((w) => w.city === 'Guayaquil')?.id ?? wh?.id ?? 'WH-QT-01',
      warehouseName:
        s.warehouses.find((w) => w.city === 'Guayaquil')?.name ?? wh?.name ?? 'Bodega Quito',
      stops: 3,
      delivered: 2,
      kg: 380,
      km: 58,
      cost: 46.4,
      etaHours: 4.1,
      status: 'Parcial',
    },
    {
      id: 'RH-1025-T03',
      date: '2026-10-25',
      truckId: 'T03',
      plate: 'CUE-3301',
      label: 'Camión 03',
      city: 'Cuenca',
      warehouseId: s.warehouses.find((w) => w.city === 'Cuenca')?.id ?? wh?.id ?? 'WH-QT-01',
      warehouseName: s.warehouses.find((w) => w.city === 'Cuenca')?.name ?? wh?.name ?? 'Bodega Quito',
      stops: 2,
      delivered: 1,
      kg: 510,
      km: 48,
      cost: 36.0,
      etaHours: 3.5,
      status: 'Incidencia',
    },
    {
      id: 'RH-1024-T01',
      date: '2026-10-24',
      truckId: 'T01',
      plate: 'GBA-2041',
      label: 'Camión 01',
      city: 'Quito',
      warehouseId: wh?.id ?? 'WH-QT-01',
      warehouseName: wh?.name ?? 'Bodega Quito',
      stops: 5,
      delivered: 5,
      kg: 610,
      km: 71,
      cost: 60.35,
      etaHours: 3.8,
      status: 'Completada',
    },
    {
      id: 'RH-1023-T04',
      date: '2026-10-23',
      truckId: 'T04',
      plate: 'AMB-5520',
      label: 'Camión 04',
      city: 'Santo Domingo',
      warehouseId: wh?.id ?? 'WH-QT-01',
      warehouseName: wh?.name ?? 'Bodega Quito',
      stops: 3,
      delivered: 3,
      kg: 290,
      km: 54,
      cost: 42.12,
      etaHours: 3.2,
      status: 'Completada',
    },
  ];

  if (delivered.length) {
    demo.unshift({
      id: `RH-live-${delivered[0].id}`,
      date: delivered[0].date,
      truckId: 'T01',
      plate: delivered[0].vehicle || 'GBA-2041',
      label: 'Camión 01',
      city: cityOf(s, delivered[0]),
      warehouseId: wh?.id ?? 'WH-QT-01',
      warehouseName: wh?.name ?? 'Bodega Quito',
      stops: delivered.length,
      delivered: delivered.length,
      kg: Math.round(delivered.reduce((n, o) => n + orderWeight(s, o), 0)),
      km: 40,
      cost: 34,
      etaHours: 2.5,
      status: 'Completada',
    });
  }

  return demo.sort((a, b) => b.date.localeCompare(a.date));
}
