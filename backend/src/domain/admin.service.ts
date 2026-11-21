import {
  getAdminDb,
  type Company,
  type MenuItem,
  type MobileRole,
  type ModuleRow,
  type Vehicle,
  type VehicleKind,
} from '../infrastructure/db/adminDb.js';

const VEHICLE_KINDS = new Set<VehicleKind>(['carro', 'camion', 'motocicleta']);

function normalizeVehicleKind(raw?: string | null): VehicleKind {
  const v = String(raw || 'camion').trim().toLowerCase() as VehicleKind;
  return VEHICLE_KINDS.has(v) ? v : 'camion';
}

const KIND_DEFAULTS: Record<
  VehicleKind,
  { maxKg: number; maxM3: number; costPerKm: number; etaHours: number; routeKm: number }
> = {
  motocicleta: { maxKg: 80, maxM3: 0.3, costPerKm: 0.35, etaHours: 1.5, routeKm: 25 },
  carro: { maxKg: 800, maxM3: 2.5, costPerKm: 0.55, etaHours: 2.5, routeKm: 40 },
  camion: { maxKg: 3500, maxM3: 14, costPerKm: 0.8, etaHours: 3.5, routeKm: 50 },
};

export function vehicleTypeLabel(kind: VehicleKind) {
  if (kind === 'motocicleta') return 'Motocicleta';
  if (kind === 'carro') return 'Carro';
  return 'Camión';
}

function slugify(name: string) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

export function listCompanies() {
  const db = getAdminDb();
  return db
    .prepare(
      `SELECT c.*,
        (SELECT COUNT(*) FROM company_modules cm WHERE cm.company_id = c.id AND cm.enabled = 1) AS modules_count,
        (SELECT COUNT(*) FROM vehicles v WHERE v.company_id = c.id AND v.active = 1) AS vehicles_count,
        (SELECT COUNT(*) FROM company_mobile_roles mr WHERE mr.company_id = c.id AND mr.enabled = 1) AS mobile_roles_count
       FROM companies c
       ORDER BY c.name`,
    )
    .all() as Array<
    Company & { modules_count: number; vehicles_count: number; mobile_roles_count: number }
  >;
}

export function getCompany(id: string) {
  const db = getAdminDb();
  return db.prepare('SELECT * FROM companies WHERE id = ?').get(id) as Company | undefined;
}

export function createCompany(input: { name: string; slug?: string }) {
  const name = input.name.trim();
  if (!name) throw new Error('Nombre de empresa requerido');
  const slug = (input.slug?.trim() || slugify(name)).toLowerCase();
  if (!slug) throw new Error('Slug inválido');
  const id = `co-${slug}`.slice(0, 40);
  const db = getAdminDb();
  const exists = db.prepare('SELECT id FROM companies WHERE id = ? OR slug = ?').get(id, slug);
  if (exists) throw new Error('Ya existe una empresa con ese nombre o slug');
  db.prepare(
    `INSERT INTO companies (id, name, slug, active, created_at) VALUES (?, ?, ?, 1, ?)`,
  ).run(id, name, slug, new Date().toISOString());
  // Módulos base mínimos
  for (const mid of ['mod-home', 'mod-inventory', 'mod-orders', 'mod-settings']) {
    db.prepare(
      `INSERT OR IGNORE INTO company_modules (company_id, module_id, enabled) VALUES (?, ?, 1)`,
    ).run(id, mid);
  }
  db.prepare(
    `INSERT OR IGNORE INTO company_mobile_roles (company_id, mobile_role_id, enabled)
     VALUES (?, 'mrole-ops', 1)`,
  ).run(id);
  return getCompany(id)!;
}

export function updateCompany(id: string, input: { name?: string; active?: boolean }) {
  const current = getCompany(id);
  if (!current) throw new Error('Empresa no encontrada');
  const db = getAdminDb();
  db.prepare(`UPDATE companies SET name = ?, active = ? WHERE id = ?`).run(
    input.name?.trim() || current.name,
    input.active === undefined ? current.active : input.active ? 1 : 0,
    id,
  );
  return getCompany(id)!;
}

export function listModules() {
  const db = getAdminDb();
  return db
    .prepare('SELECT * FROM modules WHERE active = 1 ORDER BY sort_order, name')
    .all() as ModuleRow[];
}

export function listAllModules() {
  const db = getAdminDb();
  return db.prepare('SELECT * FROM modules ORDER BY sort_order, name').all() as ModuleRow[];
}

export function companyModuleIds(companyId: string) {
  const db = getAdminDb();
  const rows = db
    .prepare(
      `SELECT module_id FROM company_modules WHERE company_id = ? AND enabled = 1`,
    )
    .all(companyId) as Array<{ module_id: string }>;
  return rows.map((r) => r.module_id);
}

export function setCompanyModules(companyId: string, moduleIds: string[]) {
  const company = getCompany(companyId);
  if (!company) throw new Error('Empresa no encontrada');
  const db = getAdminDb();
  const valid = new Set(listAllModules().map((m) => m.id));
  const unique = [...new Set(moduleIds)].filter((id) => valid.has(id));
  if (!unique.includes('mod-home')) unique.unshift('mod-home');

  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM company_modules WHERE company_id = ?').run(companyId);
    const ins = db.prepare(
      `INSERT INTO company_modules (company_id, module_id, enabled) VALUES (?, ?, 1)`,
    );
    for (const mid of unique) ins.run(companyId, mid);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return companyModuleIds(companyId);
}

export function listMenuItems() {
  const db = getAdminDb();
  return db
    .prepare(
      `SELECT mi.*, m.code AS module_code, m.name AS module_name
       FROM menu_items mi
       JOIN modules m ON m.id = mi.module_id
       ORDER BY mi.section, mi.sort_order, mi.label`,
    )
    .all() as Array<MenuItem & { module_code: string; module_name: string }>;
}

export function menuForCompany(companyId: string) {
  const db = getAdminDb();
  const company = getCompany(companyId);
  if (!company || !company.active) {
    return { company: null, sections: [] as Array<{ section: string; items: MenuItem[] }> };
  }
  const items = db
    .prepare(
      `SELECT mi.*
       FROM menu_items mi
       JOIN company_modules cm ON cm.module_id = mi.module_id AND cm.company_id = ? AND cm.enabled = 1
       JOIN modules m ON m.id = mi.module_id AND m.active = 1
       WHERE mi.active = 1
       ORDER BY CASE mi.section
                  WHEN 'Operación' THEN 0
                  WHEN 'Abastecimiento' THEN 1
                  WHEN 'Bodega' THEN 2
                  WHEN 'Gestión' THEN 3
                  ELSE 4
                END,
                mi.sort_order, mi.label`,
    )
    .all(companyId) as MenuItem[];

  const sectionsMap = new Map<string, MenuItem[]>();
  for (const item of items) {
    const list = sectionsMap.get(item.section) ?? [];
    list.push(item);
    sectionsMap.set(item.section, list);
  }
  const sections = [...sectionsMap.entries()].map(([section, sectionItems]) => ({
    section,
    items: sectionItems,
  }));
  return { company, sections };
}

export function updateMenuItem(
  id: string,
  input: { label?: string; path?: string; icon?: string; section?: string; sort_order?: number; badge?: string | null; active?: boolean },
) {
  const db = getAdminDb();
  const current = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(id) as MenuItem | undefined;
  if (!current) throw new Error('Ítem de menú no encontrado');
  db.prepare(
    `UPDATE menu_items
     SET label = ?, path = ?, icon = ?, section = ?, sort_order = ?, badge = ?, active = ?
     WHERE id = ?`,
  ).run(
    input.label?.trim() || current.label,
    input.path?.trim() || current.path,
    input.icon?.trim() || current.icon,
    input.section?.trim() || current.section,
    input.sort_order ?? current.sort_order,
    input.badge === undefined ? current.badge : input.badge,
    input.active === undefined ? current.active : input.active ? 1 : 0,
    id,
  );
  return db.prepare('SELECT * FROM menu_items WHERE id = ?').get(id) as MenuItem;
}

export function listMobileRoles() {
  const db = getAdminDb();
  return db
    .prepare('SELECT * FROM mobile_roles WHERE active = 1 ORDER BY sort_order, name')
    .all() as MobileRole[];
}

export function companyMobileRoleIds(companyId: string) {
  const db = getAdminDb();
  return (
    db
      .prepare(
        `SELECT mobile_role_id FROM company_mobile_roles
         WHERE company_id = ? AND enabled = 1`,
      )
      .all(companyId) as Array<{ mobile_role_id: string }>
  ).map((r) => r.mobile_role_id);
}

export function setCompanyMobileRoles(companyId: string, roleIds: string[]) {
  const company = getCompany(companyId);
  if (!company) throw new Error('Empresa no encontrada');
  const db = getAdminDb();
  const valid = new Set(listMobileRoles().map((r) => r.id));
  const unique = [...new Set(roleIds)].filter((id) => valid.has(id));
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM company_mobile_roles WHERE company_id = ?').run(companyId);
    const ins = db.prepare(
      `INSERT INTO company_mobile_roles (company_id, mobile_role_id, enabled) VALUES (?, ?, 1)`,
    );
    for (const id of unique) ins.run(companyId, id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return companyMobileRoleIds(companyId);
}

export function mobileConfigForCompany(companyId: string) {
  const company = getCompany(companyId);
  const db = getAdminDb();
  const roles = db
    .prepare(
      `SELECT r.*
       FROM mobile_roles r
       JOIN company_mobile_roles cm ON cm.mobile_role_id = r.id AND cm.company_id = ? AND cm.enabled = 1
       WHERE r.active = 1
       ORDER BY r.sort_order`,
    )
    .all(companyId) as MobileRole[];
  return {
    company,
    roles,
    authRoles: roles.map((r) => r.auth_role),
  };
}

export function listVehicles(companyId: string) {
  const db = getAdminDb();
  return db
    .prepare(
      `SELECT * FROM vehicles
       WHERE company_id = ?
       ORDER BY sort_order, label`,
    )
    .all(companyId) as Vehicle[];
}

export function getVehicle(id: string) {
  const db = getAdminDb();
  return db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id) as Vehicle | undefined;
}

export function parseAllowedSectors(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return [
      ...new Set(
        parsed
          .map((x) => String(x ?? '').trim())
          .filter(Boolean),
      ),
    ];
  } catch {
    return raw
      .split(/[,;|]/)
      .map((x) => x.trim())
      .filter(Boolean);
  }
}

export function serializeAllowedSectors(sectors: string[] | undefined | null): string {
  if (!sectors?.length) return '[]';
  const unique = [
    ...new Set(sectors.map((s) => String(s).trim()).filter(Boolean)),
  ];
  return JSON.stringify(unique);
}

/** Vacío = sin restricción de sector. */
export function vehicleAllowsSector(allowedSectors: string[] | undefined, sector: string) {
  if (!allowedSectors?.length) return true;
  const target = sector.trim().toLowerCase();
  if (!target) return true;
  return allowedSectors.some((s) => {
    const a = s.toLowerCase();
    return a === target || a.includes(target) || target.includes(a);
  });
}

export function fleetForCompany(companyId: string) {
  return listVehicles(companyId)
    .filter((v) => v.active)
    .map((v) => {
      const kind = normalizeVehicleKind(v.vehicle_type);
      return {
        id: v.id,
        plate: v.plate,
        label: v.label,
        vehicleType: kind,
        vehicleTypeLabel: vehicleTypeLabel(kind),
        city: v.city,
        driver: v.driver,
        maxKg: v.max_kg,
        maxM3: v.max_m3,
        costPerKm: v.cost_per_km,
        etaHours: v.eta_hours,
        routeKm: v.route_km,
        allowedSectors: parseAllowedSectors(v.allowed_sectors),
        baseOccupancy: 0,
      };
    });
}

export function createVehicle(
  companyId: string,
  input: {
    plate: string;
    label: string;
    vehicleType?: string;
    city?: string;
    driver?: string;
    maxKg?: number;
    maxM3?: number;
    costPerKm?: number;
    etaHours?: number;
    routeKm?: number;
    allowedSectors?: string[];
  },
) {
  const company = getCompany(companyId);
  if (!company) throw new Error('Empresa no encontrada');
  const plate = input.plate.trim().toUpperCase();
  const label = input.label.trim();
  if (!plate || !label) throw new Error('Placa y nombre son requeridos');
  const kind = normalizeVehicleKind(input.vehicleType);
  const defaults = KIND_DEFAULTS[kind];
  const db = getAdminDb();
  const exists = db
    .prepare('SELECT id FROM vehicles WHERE company_id = ? AND plate = ?')
    .get(companyId, plate);
  if (exists) throw new Error('Ya existe un vehículo con esa placa en la empresa');
  const id = `veh-${plate.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`;
  const count = (
    db.prepare('SELECT COUNT(*) AS c FROM vehicles WHERE company_id = ?').get(companyId) as {
      c: number;
    }
  ).c;
  db.prepare(
    `INSERT INTO vehicles
     (id, company_id, plate, label, vehicle_type, city, driver, max_kg, max_m3, cost_per_km, eta_hours, route_km, allowed_sectors, active, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
  ).run(
    id,
    companyId,
    plate,
    label,
    kind,
    input.city?.trim() || '',
    input.driver?.trim() || '',
    Number(input.maxKg ?? defaults.maxKg),
    Number(input.maxM3 ?? defaults.maxM3),
    Number(input.costPerKm ?? defaults.costPerKm),
    Number(input.etaHours ?? defaults.etaHours),
    Number(input.routeKm ?? defaults.routeKm),
    serializeAllowedSectors(input.allowedSectors),
    (count + 1) * 10,
  );
  return db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id) as Vehicle;
}

export function updateVehicle(
  id: string,
  input: Partial<{
    plate: string;
    label: string;
    vehicleType: string;
    city: string;
    driver: string;
    maxKg: number;
    maxM3: number;
    costPerKm: number;
    etaHours: number;
    routeKm: number;
    allowedSectors: string[];
    active: boolean;
  }>,
) {
  const db = getAdminDb();
  const current = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id) as Vehicle | undefined;
  if (!current) throw new Error('Vehículo no encontrado');
  const kind =
    input.vehicleType !== undefined
      ? normalizeVehicleKind(input.vehicleType)
      : normalizeVehicleKind(current.vehicle_type);
  const sectorsJson =
    input.allowedSectors !== undefined
      ? serializeAllowedSectors(input.allowedSectors)
      : current.allowed_sectors ?? '[]';
  db.prepare(
    `UPDATE vehicles
     SET plate = ?, label = ?, vehicle_type = ?, city = ?, driver = ?, max_kg = ?, max_m3 = ?,
         cost_per_km = ?, eta_hours = ?, route_km = ?, allowed_sectors = ?, active = ?
     WHERE id = ?`,
  ).run(
    input.plate?.trim().toUpperCase() || current.plate,
    input.label?.trim() || current.label,
    kind,
    input.city?.trim() ?? current.city,
    input.driver?.trim() ?? current.driver,
    input.maxKg ?? current.max_kg,
    input.maxM3 ?? current.max_m3,
    input.costPerKm ?? current.cost_per_km,
    input.etaHours ?? current.eta_hours,
    input.routeKm ?? current.route_km,
    sectorsJson,
    input.active === undefined ? current.active : input.active ? 1 : 0,
    id,
  );
  return db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id) as Vehicle;
}

export function deleteVehicle(id: string) {
  const db = getAdminDb();
  const current = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id) as Vehicle | undefined;
  if (!current) throw new Error('Vehículo no encontrado');
  db.prepare('DELETE FROM vehicles WHERE id = ?').run(id);
  return { ok: true };
}
