import type { AppState, Order } from '../types';

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
  },
];

export const ROUTE_STATUSES = new Set(['En ruta', 'Incidencia']);

export function truckByPlate(plate?: string) {
  return FLEET.find((t) => t.plate === plate) ?? FLEET[0];
}

export function clientOf(s: AppState, id: string) {
  return s.clients.find((c) => c.id === id);
}

export function productOf(s: AppState, id: string) {
  return s.products.find((p) => p.id === id);
}

export function orderWeight(s: AppState, o: Order) {
  return o.lines.reduce((n, l) => n + l.qty * (productOf(s, l.productId)?.weight ?? 0), 0);
}

export function cityOf(s: AppState, o: Order) {
  const c = clientOf(s, o.clientId);
  if (c?.city) return c.city;
  return 'Quito';
}

export function sectorOf(s: AppState, o: Order) {
  const c = clientOf(s, o.clientId);
  return c?.sector || c?.address || 'Sin sector';
}

export function routeOrders(s: AppState, plate: string) {
  return s.orders.filter(
    (o) => o.vehicle === plate && ROUTE_STATUSES.has(o.status) && !o.id.startsWith('PED-H'),
  );
}

export function packagesOf(o: Order) {
  return o.lines.length;
}

export function fmtHours(h: number) {
  const hours = Math.floor(h);
  const mins = Math.round((h - hours) * 60);
  return `${hours}h ${String(mins).padStart(2, '0')}min`;
}

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
