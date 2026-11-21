import type { AppState, Vehicle } from './types.js';

export function defaultVehicles(): Vehicle[] {
  return [
    { id: 'T01', plate: 'GBA-2041', label: 'Camión 01', city: 'Quito', driver: 'Carlos Sur', maxKg: 5000, maxM3: 20, costPerKm: 0.85, active: true },
    { id: 'T02', plate: 'GYE-1188', label: 'Camión 02', city: 'Guayaquil', driver: 'María Costa', maxKg: 4000, maxM3: 16, costPerKm: 0.8, active: true },
    { id: 'T03', plate: 'CUE-3301', label: 'Camión 03', city: 'Cuenca', driver: 'Luis Andes', maxKg: 3000, maxM3: 12, costPerKm: 0.75, active: true },
    { id: 'T04', plate: 'AMB-5520', label: 'Camión 04', city: 'Santo Domingo', driver: 'Ana Rivera', maxKg: 4500, maxM3: 18, costPerKm: 0.78, active: true },
  ];
}

export function ensureVehicles(s: AppState): Vehicle[] {
  if (!Array.isArray(s.vehicles)) s.vehicles = s.demo === false ? [] : defaultVehicles();
  else if (!s.vehicles.length && s.demo !== false) s.vehicles = defaultVehicles();
  return s.vehicles;
}

export const activeVehicles = (s: AppState) => ensureVehicles(s).filter((v) => v.active);

export const vehicleByPlate = (s: AppState, plate: string) =>
  ensureVehicles(s).find((v) => v.plate.toUpperCase() === plate.trim().toUpperCase());

const ACTIVE_ROUTE = ['En ruta', 'Incidencia'];

function cleanText(value: unknown, field: string) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(`Completa el campo ${field}.`);
  return text;
}

function positive(value: unknown, field: string) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${field} debe ser un número mayor que cero.`);
  return n;
}

const FUELS = ['gasolina', 'diesel', 'gas', 'electrico'] as const;

function fuelOf(value: string): Vehicle['fuel'] {
  if (!FUELS.includes(value as (typeof FUELS)[number])) {
    throw new Error('El combustible debe ser gasolina, diésel, gas o eléctrico.');
  }
  return value as Vehicle['fuel'];
}

export function upsertVehicle(s: AppState, input: Partial<Vehicle>) {
  const vehicles = ensureVehicles(s);
  const plate = cleanText(input.plate, 'placa').toUpperCase();
  const data = {
    plate,
    label: cleanText(input.label, 'nombre'),
    city: cleanText(input.city, 'ciudad'),
    driver: cleanText(input.driver, 'conductor'),
    maxKg: positive(input.maxKg, 'La capacidad en kg'),
    maxM3: positive(input.maxM3, 'La capacidad en m³'),
    costPerKm: positive(input.costPerKm, 'El costo por km'),
    active: input.active !== false,
    ...(input.fuel ? { fuel: fuelOf(input.fuel) } : {}),
    ...(input.kmPerUnit != null ? { kmPerUnit: positive(input.kmPerUnit, 'El rendimiento') } : {}),
    ...(input.fuelPrice != null ? { fuelPrice: positive(input.fuelPrice, 'El precio del combustible') } : {}),
  };
  const existing = input.id ? vehicles.find((v) => v.id === input.id) : undefined;
  if (input.id && !existing) throw new Error('Vehículo no encontrado.');
  if (vehicles.some((v) => v.plate === plate && v.id !== existing?.id)) {
    throw new Error('Ya existe un vehículo con esa placa.');
  }
  if (existing) {
    const onRoute = s.orders.some((o) => o.vehicle === existing.plate && ACTIVE_ROUTE.includes(o.status));
    if (onRoute && (existing.plate !== plate || !data.active)) {
      throw new Error('El vehículo tiene pedidos en ruta: no puedes cambiar su placa ni desactivarlo.');
    }
    Object.assign(existing, data);
    return existing;
  }
  const n = Math.max(0, ...vehicles.map((v) => Number(v.id.replace(/\D/g, '')) || 0)) + 1;
  const vehicle: Vehicle = { id: `T${String(n).padStart(2, '0')}`, ...data };
  vehicles.push(vehicle);
  return vehicle;
}

export function deleteVehicle(s: AppState, id: string) {
  const vehicles = ensureVehicles(s);
  const v = vehicles.find((x) => x.id === id);
  if (!v) throw new Error('Vehículo no encontrado.');
  if (s.orders.some((o) => o.vehicle === v.plate && ACTIVE_ROUTE.includes(o.status))) {
    throw new Error('El vehículo tiene pedidos en ruta.');
  }
  if (vehicles.length === 1) throw new Error('Debe quedar al menos un vehículo en la flota.');
  s.vehicles = vehicles.filter((x) => x.id !== id);
}
