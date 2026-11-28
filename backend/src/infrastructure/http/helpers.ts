import express from 'express';
import { getVehicle, parseAllowedSectors } from '../../domain/admin.service.js';

export function companyIdOf(req: express.Request) {
  return String(req.user?.companyId || 'co-innovamf');
}

export function assertVehicleOfCompany(vehicleId: string, companyId: string) {
  const vehicle = getVehicle(vehicleId);
  if (!vehicle) throw new Error('Vehículo no encontrado');
  if (vehicle.company_id !== companyId) throw new Error('Vehículo de otra empresa');
  return vehicle;
}

export function sectorsFromBody(body: unknown): string[] | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const raw = (body as { allowedSectors?: unknown }).allowedSectors;
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => String(x)).filter((x) => x.trim());
}

export function vehicleDto(v: ReturnType<typeof getVehicle>) {
  if (!v) return null;
  return {
    ...v,
    allowed_sectors_list: parseAllowedSectors(v.allowed_sectors),
  };
}
