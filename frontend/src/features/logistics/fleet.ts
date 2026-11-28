import { client, orderLoadKg, orderLoadM3 } from '../../shared/lib/inventory';
import {
  estimateRouteCost,
  estimateRouteEtaHours,
  estimateRouteKm,
  resolveBusinessRules,
  resolveShippingParams,
} from '../../shared/lib/businessRules';
import { vehicleAllowsZone, zonePathOf } from '../../shared/lib/zones';
import type { AppState, BusinessRules, Order } from '../../shared/types';

export type VehicleKind = 'carro' | 'camion' | 'motocicleta';

export type Truck = {
  id: string;
  plate: string;
  label: string;
  vehicleType?: VehicleKind;
  vehicleTypeLabel?: string;
  city: string;
  driver: string;
  maxKg: number;
  maxM3: number;
  costPerKm: number;
  /** Costo fijo por viaje (peaje, extras) derivado de reglas. */
  costPerTrip?: number;
  /** true si el $/km viene de reglas (llantas, combustible, etc.). */
  costFromRules?: boolean;
  etaHours: number;
  routeKm: number;
  /** Km acumulados del vehículo (odómetro). */
  odometerKm?: number;
  /** Vacío = sin restricción de sectores */
  allowedSectors?: string[];
  /** Plantilla de costo de envío (Reglas de negocio). Vacío = default empresa. */
  shippingTemplateId?: string;
  baseOccupancy: number;
};

export function truckRouteCost(t: Pick<Truck, 'routeKm' | 'costPerKm' | 'costPerTrip'>, km = t.routeKm) {
  return estimateRouteCost(km, t.costPerKm, t.costPerTrip ?? 0);
}

/** Sin zonas configuradas = sin restricción. Soporta jerarquía Provincia / Ciudad / Sector. */
export function vehicleAllowsSector(t: Pick<Truck, 'allowedSectors'>, sector: string) {
  return vehicleAllowsZone(t.allowedSectors, sector);
}

export function vehicleKindLabel(t: Truck) {
  if (t.vehicleTypeLabel) return t.vehicleTypeLabel;
  if (t.vehicleType === 'motocicleta') return 'Motocicleta';
  if (t.vehicleType === 'carro') return 'Carro';
  return 'Camión';
}

export function vehicleIconName(t: Pick<Truck, 'vehicleType'> | VehicleKind | undefined) {
  const kind = typeof t === 'string' ? t : t?.vehicleType;
  if (kind === 'motocicleta') return 'motorcycle';
  if (kind === 'carro') return 'car';
  return 'truck';
}

/** Fallback si la API de flota no responde; la fuente de verdad es /api/fleet. */
export const FLEET: Truck[] = [
  {
    id: 'veh-t01',
    plate: 'GBA-2041',
    label: 'Camión 01',
    vehicleType: 'camion',
    vehicleTypeLabel: 'Camión',
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
    id: 'veh-t02',
    plate: 'GYE-1188',
    label: 'Camión 02',
    vehicleType: 'camion',
    vehicleTypeLabel: 'Camión',
    city: 'Guayaquil',
    driver: 'María Costa',
    maxKg: 4000,
    maxM3: 16,
    costPerKm: 0.8,
    etaHours: 4.17,
    routeKm: 65,
    baseOccupancy: 0,
  },
  {
    id: 'veh-t03',
    plate: 'CUE-3301',
    label: 'Camión 03',
    vehicleType: 'camion',
    vehicleTypeLabel: 'Camión',
    city: 'Cuenca',
    driver: 'Luis Andes',
    maxKg: 3000,
    maxM3: 12,
    costPerKm: 0.75,
    etaHours: 3.83,
    routeKm: 65,
    baseOccupancy: 0,
  },
  {
    id: 'veh-t04',
    plate: 'AMB-5520',
    label: 'Camión 04',
    vehicleType: 'camion',
    vehicleTypeLabel: 'Camión',
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

export const orderVolume = (s: AppState, o: Order) => orderLoadM3(s, o);

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
  if (!c) return 'Sin zona';
  return zonePathOf(c);
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
  const kg = Math.round(all.reduce((n, o) => n + orderLoadKg(s, o), 0));
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
  fleet: Truck[] = FLEET,
  rules: BusinessRules = resolveBusinessRules(s.settings),
): AutoAssignPlan {
  const stagedSet = new Set(Object.values(alreadyStaged).flat());
  const candidates = ready
    .filter((o) => o.status === 'Preparado' && !stagedSet.has(o.id) && !o.vehicle)
    .map((o) => ({
      order: o,
      kg: orderLoadKg(s, o),
      m3: orderVolume(s, o),
      city: cityOf(s, o),
      sector: sectorOf(s, o),
    }))
    .sort((a, b) => b.kg - a.kg || b.m3 - a.m3);

  const used = new Map<string, { kg: number; m3: number; count: number }>();
  for (const t of fleet) {
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

    for (const t of fleet) {
      const cur = used.get(t.id)!;
      const nextKg = cur.kg + c.kg;
      const nextM3 = cur.m3 + c.m3;
      if (nextKg > t.maxKg + 0.01 || nextM3 > t.maxM3 + 0.01) continue;
      if (!vehicleAllowsSector(t, c.sector)) continue;

      const kgFill = nextKg / t.maxKg;
      const m3Fill = nextM3 / t.maxM3;
      const fill = Math.max(kgFill, m3Fill);
      // Preferir llenado útil sin saturar
      const fillScore =
        fill <= rules.assignIdealFillMax
          ? fill * 40
          : fill <= rules.assignNearFullFill
            ? 28
            : 10;
      const cityScore = t.city === c.city ? 100 : t.city.includes(c.city) || c.city.includes(t.city) ? 40 : 0;
      const sectorBonus = t.allowedSectors?.length ? 35 : 0;
      const costScore = (rules.assignCostReference - t.costPerKm) * rules.assignCostWeight;
      const balanceScore = Math.max(0, 18 - cur.count * 2);
      const spareScore = ((t.maxKg - nextKg) / t.maxKg) * 8;
      const score = cityScore + fillScore + costScore + balanceScore + spareScore + sectorBonus;

      const reasonParts = [
        cityScore >= 100 ? `misma ciudad (${t.city})` : cityScore > 0 ? `ciudad cercana` : `capacidad libre`,
        t.allowedSectors?.length ? `sector ${c.sector}` : 'sin regla de sector',
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
        reason: 'Sin capacidad o sector permitido en la flota disponible',
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
  incidents: number;
  pending: number;
  kg: number;
  km: number;
  cost: number;
  etaHours: number;
  status: 'Completada' | 'Parcial' | 'En ruta' | 'Incidencia';
  orderIds: string[];
};

/** Fecha operativa YYYY-MM-DD (local). */
export function opsDate(iso?: string) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function orderOpsDate(o: Order) {
  if (o.deliveredAt) return opsDate(o.deliveredAt);
  return o.date?.slice(0, 10) || opsDate();
}

/** Pedidos entregados hoy para una placa. */
export function deliveredToday(s: AppState, plate: string, day = opsDate()) {
  return s.orders.filter(
    (o) =>
      o.status === 'Entregado' &&
      o.vehicle === plate &&
      !o.id.startsWith('PED-H') &&
      orderOpsDate(o) === day,
  );
}

function resolveTruck(fleet: Truck[], plate: string, sample?: Order, s?: AppState): Truck {
  const found = fleet.find((t) => t.plate === plate);
  if (found) return found;
  const city = sample && s ? cityOf(s, sample) : 'Quito';
  return {
    id: `plate-${plate}`,
    plate,
    label: plate,
    city,
    driver: '—',
    maxKg: 3500,
    maxM3: 14,
    costPerKm: 0.8,
    etaHours: 3,
    routeKm: 40,
    baseOccupancy: 0,
  };
}

/**
 * Historial real: agrupa pedidos despachados (en ruta / incidencia / entregado)
 * por placa + fecha operativa.
 */
export function buildRouteHistory(s: AppState, fleet: Truck[] = FLEET): RouteHistoryEntry[] {
  const wh = s.warehouses[0];
  const relevant = s.orders.filter(
    (o) =>
      !o.id.startsWith('PED-H') &&
      Boolean(o.vehicle) &&
      ['Entregado', 'En ruta', 'Incidencia'].includes(o.status),
  );

  type Bucket = { plate: string; date: string; orders: Order[] };
  const buckets = new Map<string, Bucket>();
  for (const o of relevant) {
    const plate = o.vehicle!;
    const date = orderOpsDate(o);
    const key = `${plate}|${date}`;
    const cur = buckets.get(key) ?? { plate, date, orders: [] };
    cur.orders.push(o);
    buckets.set(key, cur);
  }

  const entries: RouteHistoryEntry[] = [];
  for (const b of buckets.values()) {
    const truck = resolveTruck(fleet, b.plate, b.orders[0], s);
    const shipping = resolveShippingParams(s.settings, truck.shippingTemplateId);
    const warehouse =
      s.warehouses.find((w) => w.city === truck.city) ??
      s.warehouses.find((w) => w.id === s.settings.activeWarehouseId) ??
      wh;
    const delivered = b.orders.filter((o) => o.status === 'Entregado').length;
    const incidents = b.orders.filter((o) => o.status === 'Incidencia').length;
    const pending = b.orders.filter((o) => o.status === 'En ruta').length;
    const stops = b.orders.length;
    const kg = Math.round(b.orders.reduce((n, o) => n + orderLoadKg(s, o), 0));
    const km = estimateRouteKm(truck.routeKm, stops, shipping);
    const cost = estimateRouteCost(km, truck.costPerKm);
    const etaHours = estimateRouteEtaHours(truck.etaHours, stops, shipping);
    let status: RouteHistoryEntry['status'] = 'Parcial';
    if (pending > 0) status = 'En ruta';
    else if (incidents > 0 && delivered + incidents === stops) status = 'Incidencia';
    else if (delivered === stops) status = 'Completada';
    else if (incidents > 0) status = 'Incidencia';

    entries.push({
      id: `RH-${b.date.replace(/-/g, '')}-${b.plate}`,
      date: b.date,
      truckId: truck.id,
      plate: truck.plate,
      label: truck.label,
      city: truck.city,
      warehouseId: warehouse?.id ?? 'WH-QT-01',
      warehouseName: warehouse?.name ?? 'Bodega',
      stops,
      delivered,
      incidents,
      pending,
      kg,
      km,
      cost,
      etaHours,
      status,
      orderIds: b.orders.map((o) => o.id).sort(),
    });
  }

  return entries.sort((a, b) => b.date.localeCompare(a.date) || a.plate.localeCompare(b.plate));
}
