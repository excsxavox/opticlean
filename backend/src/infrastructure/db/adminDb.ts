import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Usuarios y empresas no siguen a OPTICLEAN_DATA_DIR (esa es la carpeta del estado): moverlos
// dejaría una instalación existente sin sus cuentas. Se cambian solo con su propia variable.
const DATA_DIR = process.env.OPTICLEAN_AUTH_DATA_DIR?.trim() || path.resolve(__dirname, '../../../../data');
const DB_PATH = path.join(DATA_DIR, 'admin.db');

let db: DatabaseSync | null = null;

/** Ruta del archivo SQLite (para respaldos). */
export const adminDbPath = () => DB_PATH;

export type Company = {
  id: string;
  name: string;
  slug: string;
  active: number;
  created_at: string;
};

export type ModuleRow = {
  id: string;
  code: string;
  name: string;
  description: string;
  icon: string;
  active: number;
  sort_order: number;
};

export type MenuItem = {
  id: string;
  module_id: string;
  label: string;
  path: string;
  icon: string;
  section: string;
  sort_order: number;
  badge: string | null;
  active: number;
};

export type MobileRole = {
  id: string;
  code: string;
  name: string;
  description: string;
  auth_role: string;
  icon: string;
  sort_order: number;
  active: number;
};

/** carro | camion | motocicleta */
export type VehicleKind = 'carro' | 'camion' | 'motocicleta';

export type Vehicle = {
  id: string;
  company_id: string;
  plate: string;
  label: string;
  vehicle_type: VehicleKind;
  city: string;
  driver: string;
  max_kg: number;
  max_m3: number;
  cost_per_km: number;
  eta_hours: number;
  route_km: number;
  /** Km acumulados reales/estimados del vehículo. */
  odometer_km: number;
  /** JSON array de sectores permitidos. [] = sin restricción */
  allowed_sectors: string;
  /** Plantilla de costo de envío (settings.shippingTemplates). Vacío = default empresa. */
  shipping_template_id: string;
  active: number;
  sort_order: number;
};

export type VehicleKmLog = {
  id: string;
  company_id: string;
  vehicle_id: string;
  plate: string;
  km: number;
  stops: number;
  source: 'dispatch' | 'manual' | 'adjust';
  note: string;
  order_ids: string;
  odometer_after: number;
  created_at: string;
};

const SEED_MODULES: Array<Omit<ModuleRow, 'active'> & { active?: number }> = [
  { id: 'mod-home', code: 'home', name: 'Inicio', description: 'Resumen operativo', icon: 'home', sort_order: 10 },
  { id: 'mod-inventory', code: 'inventory', name: 'Inventario', description: 'Stock y productos', icon: 'box', sort_order: 20 },
  { id: 'mod-reception', code: 'reception', name: 'Recepción', description: 'Ingresos a bodega', icon: 'receive', sort_order: 30 },
  {
    id: 'mod-warehouse-visual',
    code: 'warehouse_visual',
    name: 'Bodega visual',
    description: 'Mapa y picking visual',
    icon: 'warehouse',
    sort_order: 40,
  },
  {
    id: 'mod-warehouses',
    code: 'warehouses',
    name: 'Bodegas',
    description: 'Administración de bodegas',
    icon: 'building',
    sort_order: 50,
  },
  { id: 'mod-families', code: 'families', name: 'Familias', description: 'Familias de ubicación', icon: 'layers', sort_order: 60 },
  { id: 'mod-orders', code: 'orders', name: 'Pedidos', description: 'Pedidos y preparación', icon: 'orders', sort_order: 70 },
  {
    id: 'mod-packing',
    code: 'packing',
    name: 'Empaque',
    description: 'Empaque y carga de pedidos preparados',
    icon: 'cube',
    sort_order: 85,
  },
  { id: 'mod-purchases', code: 'purchases', name: 'Abastecimiento', description: 'Órdenes de compra', icon: 'cart', sort_order: 80 },
  { id: 'mod-logistics', code: 'logistics', name: 'Logística', description: 'Distribución y camiones', icon: 'truck', sort_order: 90 },
  { id: 'mod-routes', code: 'routes', name: 'Mi ruta', description: 'Ruta del conductor', icon: 'route', sort_order: 100 },
  {
    id: 'mod-route-history',
    code: 'route_history',
    name: 'Historial rutas',
    description: 'Histórico de despachos',
    icon: 'history',
    sort_order: 110,
  },
  { id: 'mod-clients', code: 'clients', name: 'Clientes', description: 'Directorio de clientes', icon: 'users', sort_order: 120 },
  { id: 'mod-suppliers', code: 'suppliers', name: 'Proveedores', description: 'Directorio de proveedores', icon: 'building', sort_order: 122 },
  {
    id: 'mod-commercial',
    code: 'commercial',
    name: 'Comercial',
    description: 'Facturas, cartera, precios, conteo y traslados',
    icon: 'orders',
    sort_order: 125,
  },
  {
    id: 'mod-traceability',
    code: 'traceability',
    name: 'Trazabilidad',
    description: 'Eventos de movimiento',
    icon: 'route',
    sort_order: 130,
  },
  { id: 'mod-reports', code: 'reports', name: 'Reportes', description: 'Indicadores y reportes', icon: 'chart', sort_order: 140 },
  {
    id: 'mod-business-rules',
    code: 'business_rules',
    name: 'Reglas de negocio',
    description: 'Costo de envío, crédito y asignación',
    icon: 'shield',
    sort_order: 145,
  },
  {
    id: 'mod-users',
    code: 'users',
    name: 'Usuarios',
    description: 'Alta de usuarios y roles (admin)',
    icon: 'users',
    sort_order: 148,
  },
  {
    id: 'mod-settings',
    code: 'settings',
    name: 'Configuración',
    description: 'Ajustes de la operación',
    icon: 'settings',
    sort_order: 150,
  },
];

const SEED_MENU: Array<Omit<MenuItem, 'active' | 'badge'> & { badge?: string | null }> = [
  { id: 'mi-home', module_id: 'mod-home', label: 'Inicio', path: '/', icon: 'home', section: 'Operación', sort_order: 10 },
  {
    id: 'mi-inventory',
    module_id: 'mod-inventory',
    label: 'Inventario',
    path: '/inventario',
    icon: 'box',
    section: 'Operación',
    sort_order: 20,
  },
  {
    id: 'mi-reception',
    module_id: 'mod-reception',
    label: 'Recepción',
    path: '/recepcion',
    icon: 'receive',
    section: 'Operación',
    sort_order: 30,
  },
  {
    id: 'mi-warehouse',
    module_id: 'mod-warehouse-visual',
    label: 'Bodega visual',
    path: '/bodega',
    icon: 'warehouse',
    section: 'Bodega',
    sort_order: 20,
    badge: null,
  },
  {
    id: 'mi-orders',
    module_id: 'mod-orders',
    label: 'Pedidos',
    path: '/pedidos',
    icon: 'orders',
    section: 'Operación',
    sort_order: 50,
  },
  {
    id: 'mi-packing',
    module_id: 'mod-packing',
    label: 'Empaque',
    path: '/empaque',
    icon: 'cube',
    section: 'Operación',
    sort_order: 60,
  },
  {
    id: 'mi-logistics',
    module_id: 'mod-logistics',
    label: 'Logística',
    path: '/logistica',
    icon: 'truck',
    section: 'Operación',
    sort_order: 70,
  },
  {
    id: 'mi-routes',
    module_id: 'mod-routes',
    label: 'Mi ruta',
    path: '/logistica/rutas',
    icon: 'route',
    section: 'Operación',
    sort_order: 80,
  },
  {
    id: 'mi-route-history',
    module_id: 'mod-route-history',
    label: 'Historial rutas',
    path: '/logistica/historial',
    icon: 'history',
    section: 'Operación',
    sort_order: 90,
  },
  {
    id: 'mi-trace',
    module_id: 'mod-traceability',
    label: 'Trazabilidad',
    path: '/trazabilidad',
    icon: 'route',
    section: 'Operación',
    sort_order: 100,
  },
  {
    id: 'mi-plan',
    module_id: 'mod-purchases',
    label: 'Plan de mañana',
    path: '/plan',
    icon: 'calendar',
    section: 'Gestión',
    sort_order: 5,
  },
  {
    id: 'mi-purchases',
    module_id: 'mod-purchases',
    label: 'Abastecimiento',
    path: '/compras',
    icon: 'cart',
    section: 'Abastecimiento',
    sort_order: 20,
  },
  {
    id: 'mi-suppliers',
    module_id: 'mod-suppliers',
    label: 'Proveedores',
    path: '/proveedores',
    icon: 'building',
    section: 'Abastecimiento',
    sort_order: 30,
  },
  {
    id: 'mi-warehouses',
    module_id: 'mod-warehouses',
    label: 'Bodegas',
    path: '/bodegas',
    icon: 'building',
    section: 'Bodega',
    sort_order: 10,
  },
  {
    id: 'mi-families',
    module_id: 'mod-families',
    label: 'Familias',
    path: '/familias',
    icon: 'layers',
    section: 'Bodega',
    sort_order: 30,
  },
  {
    id: 'mi-clients',
    module_id: 'mod-clients',
    label: 'Clientes',
    path: '/clientes',
    icon: 'users',
    section: 'Gestión',
    sort_order: 10,
  },
  {
    id: 'mi-commercial',
    module_id: 'mod-commercial',
    label: 'Comercial',
    path: '/comercial',
    icon: 'orders',
    section: 'Gestión',
    sort_order: 20,
  },
  {
    id: 'mi-reports',
    module_id: 'mod-reports',
    label: 'Reportes',
    path: '/reportes',
    icon: 'chart',
    section: 'Gestión',
    sort_order: 30,
  },
  {
    id: 'mi-business-rules',
    module_id: 'mod-business-rules',
    label: 'Reglas de negocio',
    path: '/reglas',
    icon: 'shield',
    section: 'Gestión',
    sort_order: 40,
  },
  {
    id: 'mi-users',
    module_id: 'mod-users',
    label: 'Usuarios',
    path: '/usuarios',
    icon: 'users',
    section: 'Gestión',
    sort_order: 50,
  },
  {
    id: 'mi-settings',
    module_id: 'mod-settings',
    label: 'Configuración',
    path: '/configuracion',
    icon: 'settings',
    section: 'Gestión',
    sort_order: 60,
  },
];

function seed(database: DatabaseSync) {
  const companyCount = database.prepare('SELECT COUNT(*) AS c FROM companies').get() as { c: number };
  if (companyCount.c === 0) {
    database
      .prepare(
        `INSERT INTO companies (id, name, slug, active, created_at)
         VALUES (?, ?, ?, 1, ?)`,
      )
      .run('co-innovamf', 'Innova MF', 'innovamf', new Date().toISOString());
    database
      .prepare(
        `INSERT INTO companies (id, name, slug, active, created_at)
         VALUES (?, ?, ?, 1, ?)`,
      )
      .run('co-demo', 'Cliente Demo', 'cliente-demo', new Date().toISOString());
  }

  for (const m of SEED_MODULES) {
    database
      .prepare(
        `INSERT OR IGNORE INTO modules (id, code, name, description, icon, active, sort_order)
         VALUES (?, ?, ?, ?, ?, 1, ?)`,
      )
      .run(m.id, m.code, m.name, m.description, m.icon, m.sort_order);
  }

  for (const item of SEED_MENU) {
    database
      .prepare(
        `INSERT OR IGNORE INTO menu_items
         (id, module_id, label, path, icon, section, sort_order, badge, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      )
      .run(
        item.id,
        item.module_id,
        item.label,
        item.path,
        item.icon,
        item.section,
        item.sort_order,
        item.badge ?? null,
      );
    database
      .prepare(
        `UPDATE menu_items
         SET module_id = ?, label = ?, path = ?, icon = ?, section = ?, sort_order = ?
         WHERE id = ?`,
      )
      .run(
        item.module_id,
        item.label,
        item.path,
        item.icon,
        item.section,
        item.sort_order,
        item.id,
      );
  }

  database.prepare(`UPDATE menu_items SET badge = NULL WHERE badge = 'NUEVO'`).run();
  // Cotizaciones ya no es una entrada del menú: se abre desde Pedidos.
  database.prepare(`DELETE FROM menu_items WHERE id = 'mi-quotes'`).run();
  database
    .prepare(
      `INSERT OR IGNORE INTO company_modules (company_id, module_id, enabled)
       SELECT company_id, 'mod-suppliers', 1
       FROM company_modules
       WHERE module_id IN ('mod-purchases', 'mod-clients') AND enabled = 1`,
    )
    .run();
  // Empaque era parte de logística; ahora es módulo propio y se habilita donde ya había logística.
  database
    .prepare(
      `INSERT OR IGNORE INTO company_modules (company_id, module_id, enabled)
       SELECT company_id, 'mod-packing', 1
       FROM company_modules
       WHERE module_id = 'mod-logistics' AND enabled = 1`,
    )
    .run();

  // Innova MF: todos los módulos
  for (const m of SEED_MODULES) {
    database
      .prepare(
        `INSERT OR IGNORE INTO company_modules (company_id, module_id, enabled)
         VALUES ('co-innovamf', ?, 1)`,
      )
      .run(m.id);
  }

  // Cliente Demo: subconjunto operativo
  const demoMods = [
    'mod-home',
    'mod-inventory',
    'mod-reception',
    'mod-warehouse-visual',
    'mod-orders',
    'mod-packing',
    'mod-logistics',
    'mod-clients',
  ];
  for (const id of demoMods) {
    database
      .prepare(
        `INSERT OR IGNORE INTO company_modules (company_id, module_id, enabled)
         VALUES ('co-demo', ?, 1)`,
      )
      .run(id);
  }

  const mobileRoles: MobileRole[] = [
    {
      id: 'mrole-ops',
      code: 'warehouse',
      name: 'Bodega',
      description: 'Inventario, recibir, pedidos y bodega visual en celular',
      auth_role: 'ops',
      icon: 'warehouse',
      sort_order: 10,
      active: 1,
    },
    {
      id: 'mrole-dispatch',
      code: 'dispatch',
      name: 'Despacho',
      description: 'Asignación a camiones, IA y envío desde móvil',
      auth_role: 'dispatch',
      icon: 'truck',
      sort_order: 20,
      active: 1,
    },
    {
      id: 'mrole-driver',
      code: 'driver',
      name: 'Conductor',
      description: 'Mi ruta, mapa y confirmación de entregas',
      auth_role: 'driver',
      icon: 'route',
      sort_order: 30,
      active: 1,
    },
  ];
  for (const r of mobileRoles) {
    database
      .prepare(
        `INSERT OR IGNORE INTO mobile_roles
         (id, code, name, description, auth_role, icon, sort_order, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      )
      .run(r.id, r.code, r.name, r.description, r.auth_role, r.icon, r.sort_order);
  }

  for (const rid of ['mrole-ops', 'mrole-dispatch', 'mrole-driver']) {
    database
      .prepare(
        `INSERT OR IGNORE INTO company_mobile_roles (company_id, mobile_role_id, enabled)
         VALUES ('co-innovamf', ?, 1)`,
      )
      .run(rid);
  }
  database
    .prepare(
      `INSERT OR IGNORE INTO company_mobile_roles (company_id, mobile_role_id, enabled)
       VALUES ('co-demo', 'mrole-ops', 1)`,
    )
    .run();
  database
    .prepare(
      `INSERT OR IGNORE INTO company_mobile_roles (company_id, mobile_role_id, enabled)
       VALUES ('co-demo', 'mrole-driver', 1)`,
    )
    .run();

  const vehicles: Array<
    Omit<Vehicle, 'active' | 'allowed_sectors' | 'shipping_template_id'> & {
      allowed_sectors?: string;
      shipping_template_id?: string;
    }
  > = [
    {
      id: 'veh-t01',
      company_id: 'co-innovamf',
      plate: 'GBA-2041',
      label: 'Camión 01',
      vehicle_type: 'camion',
      city: 'Quito',
      driver: 'Carlos Sur',
      max_kg: 5000,
      max_m3: 20,
      cost_per_km: 0.85,
      eta_hours: 3.33,
      route_km: 62,
      odometer_km: 0,
      sort_order: 10,
    },
    {
      id: 'veh-t02',
      company_id: 'co-innovamf',
      plate: 'GYE-1188',
      label: 'Camión 02',
      vehicle_type: 'camion',
      city: 'Guayaquil',
      driver: 'María Costa',
      max_kg: 4000,
      max_m3: 16,
      cost_per_km: 0.8,
      eta_hours: 4.17,
      route_km: 65,
      odometer_km: 0,
      sort_order: 20,
    },
    {
      id: 'veh-t03',
      company_id: 'co-innovamf',
      plate: 'CUE-3301',
      label: 'Camión 03',
      vehicle_type: 'camion',
      city: 'Cuenca',
      driver: 'Luis Andes',
      max_kg: 3000,
      max_m3: 12,
      cost_per_km: 0.75,
      eta_hours: 3.83,
      route_km: 65,
      odometer_km: 0,
      sort_order: 30,
    },
    {
      id: 'veh-t04',
      company_id: 'co-innovamf',
      plate: 'AMB-5520',
      label: 'Camión 04',
      vehicle_type: 'camion',
      city: 'Santo Domingo',
      driver: 'Ana Rivera',
      max_kg: 4500,
      max_m3: 18,
      cost_per_km: 0.78,
      eta_hours: 4.08,
      route_km: 66,
      odometer_km: 0,
      sort_order: 40,
    },
    {
      id: 'veh-demo-1',
      company_id: 'co-demo',
      plate: 'DEM-1001',
      label: 'Camión Demo',
      vehicle_type: 'camion',
      city: 'Quito',
      driver: 'Operador Demo',
      max_kg: 3500,
      max_m3: 14,
      cost_per_km: 0.82,
      eta_hours: 3.5,
      route_km: 45,
      odometer_km: 0,
      sort_order: 10,
    },
  ];
  for (const v of vehicles) {
    database
      .prepare(
        `INSERT OR IGNORE INTO vehicles
         (id, company_id, plate, label, vehicle_type, city, driver, max_kg, max_m3, cost_per_km, eta_hours, route_km, odometer_km, active, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      )
      .run(
        v.id,
        v.company_id,
        v.plate,
        v.label,
        v.vehicle_type,
        v.city,
        v.driver,
        v.max_kg,
        v.max_m3,
        v.cost_per_km,
        v.eta_hours,
        v.route_km,
        v.odometer_km ?? 0,
        v.sort_order,
      );
  }
}

export function getAdminDb() {
  if (db) return db;
  mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS modules (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      icon TEXT NOT NULL DEFAULT 'box',
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS menu_items (
      id TEXT PRIMARY KEY,
      module_id TEXT NOT NULL,
      label TEXT NOT NULL,
      path TEXT NOT NULL,
      icon TEXT NOT NULL,
      section TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      badge TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (module_id) REFERENCES modules(id)
    );
    CREATE TABLE IF NOT EXISTS company_modules (
      company_id TEXT NOT NULL,
      module_id TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (company_id, module_id),
      FOREIGN KEY (company_id) REFERENCES companies(id),
      FOREIGN KEY (module_id) REFERENCES modules(id)
    );
    CREATE TABLE IF NOT EXISTS mobile_roles (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      auth_role TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT 'box',
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS company_mobile_roles (
      company_id TEXT NOT NULL,
      mobile_role_id TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (company_id, mobile_role_id),
      FOREIGN KEY (company_id) REFERENCES companies(id),
      FOREIGN KEY (mobile_role_id) REFERENCES mobile_roles(id)
    );
    CREATE TABLE IF NOT EXISTS vehicles (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      plate TEXT NOT NULL,
      label TEXT NOT NULL,
      vehicle_type TEXT NOT NULL DEFAULT 'camion',
      city TEXT NOT NULL DEFAULT '',
      driver TEXT NOT NULL DEFAULT '',
      max_kg REAL NOT NULL DEFAULT 3000,
      max_m3 REAL NOT NULL DEFAULT 12,
      cost_per_km REAL NOT NULL DEFAULT 0.8,
      eta_hours REAL NOT NULL DEFAULT 3.5,
      route_km REAL NOT NULL DEFAULT 50,
      odometer_km REAL NOT NULL DEFAULT 0,
      allowed_sectors TEXT NOT NULL DEFAULT '[]',
      shipping_template_id TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (company_id) REFERENCES companies(id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_company_plate
      ON vehicles(company_id, plate);
    CREATE TABLE IF NOT EXISTS vehicle_km_logs (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      vehicle_id TEXT NOT NULL,
      plate TEXT NOT NULL,
      km REAL NOT NULL,
      stops INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'dispatch',
      note TEXT NOT NULL DEFAULT '',
      order_ids TEXT NOT NULL DEFAULT '[]',
      odometer_after REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (company_id) REFERENCES companies(id),
      FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_vehicle_km_logs_vehicle
      ON vehicle_km_logs(vehicle_id, created_at);
    CREATE TABLE IF NOT EXISTS vehicle_cost_rules (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      vehicle_id TEXT,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'otro',
      basis TEXT NOT NULL DEFAULT 'per_km',
      calc TEXT NOT NULL DEFAULT 'fixed',
      amount REAL NOT NULL DEFAULT 0,
      life_units REAL NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (company_id) REFERENCES companies(id),
      FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_vehicle_cost_rules_vehicle
      ON vehicle_cost_rules(vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_vehicle_cost_rules_company
      ON vehicle_cost_rules(company_id);
  `);
  // Migraciones suaves
  try {
    const cols = db.prepare('PRAGMA table_info(vehicles)').all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'vehicle_type')) {
      db.exec(`ALTER TABLE vehicles ADD COLUMN vehicle_type TEXT NOT NULL DEFAULT 'camion'`);
    }
    if (!cols.some((c) => c.name === 'allowed_sectors')) {
      db.exec(`ALTER TABLE vehicles ADD COLUMN allowed_sectors TEXT NOT NULL DEFAULT '[]'`);
    }
    if (!cols.some((c) => c.name === 'odometer_km')) {
      db.exec(`ALTER TABLE vehicles ADD COLUMN odometer_km REAL NOT NULL DEFAULT 0`);
    }
    if (!cols.some((c) => c.name === 'shipping_template_id')) {
      db.exec(`ALTER TABLE vehicles ADD COLUMN shipping_template_id TEXT NOT NULL DEFAULT ''`);
    }
  } catch {
    /* ignore */
  }
  seed(db);
  return db;
}

export type VehicleCostRuleRow = {
  id: string;
  company_id: string;
  vehicle_id: string | null;
  name: string;
  category: string;
  basis: 'per_km' | 'per_trip';
  calc: 'fixed' | 'amortized';
  amount: number;
  life_units: number;
  active: number;
  sort_order: number;
};
