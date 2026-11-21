import cors from 'cors';
import express from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JsonStateRepository } from '../persistence/JsonStateRepository.js';
import { OperationsUseCases } from '../../application/use-cases/OperationsUseCases.js';
import { suggest, suggestPlacement } from '../../domain/placement.service.js';
import { autoAssignLogistics, openaiConfigured } from '../../domain/logistics-ai.service.js';
import { readLabel } from '../../domain/outbound.service.js';
import { renderReport } from '../../domain/report-file.js';
import {
  adminRequired,
  authRequired,
  createUser,
  deactivateUser,
  getUserById,
  listUsers,
  login,
  prepareAuth,
  publicUserFromRequest,
  updateUser,
  type AuthRole,
} from '../auth/auth.js';
import {
  companyMobileRoleIds,
  companyModuleIds,
  createCompany,
  createVehicle,
  deleteVehicle,
  fleetForCompany,
  getVehicle,
  listAllModules,
  listCompanies,
  listMenuItems,
  listMobileRoles,
  listModules,
  listVehicles,
  menuForCompany,
  mobileConfigForCompany,
  parseAllowedSectors,
  setCompanyMobileRoles,
  setCompanyModules,
  updateCompany,
  updateMenuItem,
  updateVehicle,
} from '../../domain/admin.service.js';
import { getAdminDb } from '../db/adminDb.js';
import { runAs } from '../../domain/request-context.js';
import { carriesState, stateForUser } from './state-view.js';
import { loginBlockedFor, registerLoginFailure, registerLoginSuccess } from './login-throttle.js';
import { scheduleAuthBackups } from '../persistence/auth-backup.js';

// Se evalúan al usarse porque `.env` se carga más abajo.
const isProd = () => process.env.NODE_ENV === 'production';
/** El reinicio a datos demo solo existe fuera de producción (o con permiso explícito). */
const resetAllowed = () => !isProd() || process.env.OPTICLEAN_ALLOW_RESET === '1';

function companyIdOf(req: express.Request) {
  return String(req.user?.companyId || 'co-innovamf');
}

function assertVehicleOfCompany(vehicleId: string, companyId: string) {
  const vehicle = getVehicle(vehicleId);
  if (!vehicle) throw new Error('Vehículo no encontrado');
  if (vehicle.company_id !== companyId) throw new Error('Vehículo de otra empresa');
  return vehicle;
}

function sectorsFromBody(body: unknown): string[] | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const raw = (body as { allowedSectors?: unknown }).allowedSectors;
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => String(x)).filter((x) => x.trim());
}

function vehicleDto(v: ReturnType<typeof getVehicle>) {
  if (!v) return null;
  return {
    ...v,
    allowed_sectors_list: parseAllowedSectors(v.allowed_sectors),
  };
}

/** Carga backend/.env sin dependencia extra (no pisa vars ya definidas, p.ej. systemd). */
function loadEnvFile() {
  const path = resolve(process.cwd(), '.env');
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i <= 0) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnvFile();
// En producción no arranca sin secreto propio ni con usuarios demo.
prepareAuth();

const app = express();
const repo = new JsonStateRepository();
const ops = new OperationsUseCases(repo);

/**
 * Web, app de bodega y admin llaman al API por su propio dominio (nginx), así que en
 * producción no hace falta aceptar otros orígenes. OPTICLEAN_CORS_ORIGINS (separados
 * por coma) habilita los que se necesiten; fuera de producción se aceptan todos.
 */
function corsOrigins(): cors.CorsOptions['origin'] {
  const list = (process.env.OPTICLEAN_CORS_ORIGINS ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  if (list.length) return list;
  return !isProd();
}
app.use((req, res, next) => cors({ origin: corsOrigins() })(req, res, next));
app.set('trust proxy', 'loopback');
app.use(express.json({ limit: '15mb' }));

function roleDenied(req: express.Request) {
  const role = req.user?.role;
  if (!role || role === 'admin') return null;
  if (req.method === 'GET' || req.method === 'HEAD') return null;
  const path = req.path;
  const allow = (roles: AuthRole[]) =>
    roles.includes(role) ? null : 'Tu rol no tiene permiso para esta acción.';
  if (path === '/api/delivery' || path === '/api/incidents' || path === '/api/delivery/skip') {
    return allow(['dispatch', 'driver', 'ops']);
  }
  if (path === '/api/packing' || path === '/api/loading/preview') return allow(['ops', 'dispatch']);
  if (path === '/api/dispatch' || path.startsWith('/api/logistics')) return allow(['dispatch']);
  if (path.startsWith('/api/guides')) return allow(['dispatch', 'ops']);
  if (
    path.startsWith('/api/invoices') ||
    path.startsWith('/api/credit-notes') ||
    path.startsWith('/api/payments') ||
    path.startsWith('/api/supplier-bills') ||
    path.startsWith('/api/supplier-payments') ||
    path.startsWith('/api/price-lists') ||
    path.startsWith('/api/client-prices') ||
    path.startsWith('/api/settings') ||
    path.startsWith('/api/users') ||
    path.includes('/assign') ||
    path.includes('/unassign') ||
    path === '/api/state/reset' ||
    // Separación de funciones: bodega solicita, administración aprueba.
    /^\/api\/adjustments\/[^/]+\/approve$/.test(path) ||
    /^\/api\/cycle-counts\/[^/]+\/apply$/.test(path) ||
    path.startsWith('/api/supplier-returns') ||
    /^\/api\/purchases\/[^/]+\/close$/.test(path) ||
    /^\/api\/lots\/[^/]+\/(release|reject)$/.test(path)
  ) {
    return allow([]);
  }
  if (path === '/api/receptions' && req.method === 'POST' && !req.body?.purchaseId) {
    return 'Recibir sin orden de compra requiere aprobación de administración.';
  }
  if (req.method === 'PATCH' && /^\/api\/clients\/[^/]+$/.test(path)) {
    const body = req.body ?? {};
    if (body.creditLimit != null || body.paymentTermsDays != null) {
      return 'Solo administración cambia el cupo o el plazo de crédito.';
    }
  }
  if (role === 'ops') return null;
  return 'Tu rol no tiene permiso para esta acción.';
}

app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  if (req.path === '/api/health' || req.path === '/api/auth/login' || req.path === '/api/public/delivery-code') return next();
  if (req.path.startsWith('/api/admin')) return next();
  authRequired(req, res, () => {
    if (res.headersSent) return;
    const denied = roleDenied(req);
    if (denied) {
      res.status(403).json({ error: denied });
      return;
    }
    const user = req.user!;
    // Cada movimiento queda firmado por el usuario y aislado en su empresa.
    runAs({ id: user.id, name: user.name, role: user.role, companyId: user.companyId }, () => next());
  });
});

// Ningún rol recibe más estado del que le corresponde, en ninguna respuesta.
app.use((req, res, next) => {
  const send = res.json.bind(res);
  res.json = (body: unknown) => {
    if (carriesState(body)) return send({ ...body, state: stateForUser(body.state, req.user) });
    return send(body);
  };
  next();
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.post('/api/auth/login', (req, res) => {
  try {
    const email = String(req.body?.email ?? '');
    const password = String(req.body?.password ?? '');
    if (!email || !password) {
      res.status(400).json({ error: 'Ingresa correo y contraseña' });
      return;
    }
    const ip = req.ip || 'desconocida';
    const wait = loginBlockedFor(ip, email);
    if (wait) {
      res.set('Retry-After', String(wait));
      res.status(429).json({
        error: `Demasiados intentos fallidos. Espera ${Math.ceil(wait / 60)} minuto(s) antes de volver a intentar.`,
      });
      return;
    }
    try {
      const result = login(email, password);
      registerLoginSuccess(ip, email);
      res.json(result);
    } catch (e) {
      registerLoginFailure(ip, email);
      throw e;
    }
  } catch (e) {
    res.status(401).json({ error: e instanceof Error ? e.message : 'No autorizado' });
  }
});

app.get('/api/auth/me', authRequired, (req, res) => {
  res.json({ user: publicUserFromRequest(req) });
});

app.use('/api', (req, res, next) => {
  if (req.path === '/health' || req.path === '/auth/login') return next();
  return authRequired(req, res, next);
});

app.get('/api/config', (_req, res) => {
  res.json({ production: isProd(), resetAllowed: resetAllowed() });
});

app.get('/api/meta', async (_req, res, next) => {
  try {
    res.json(await ops.getMeta());
  } catch (e) {
    next(e);
  }
});

app.get('/api/state', async (_req, res, next) => {
  try {
    const state = await ops.getState();
    res.json({ state, metrics: ops.metricsSnapshot(state) });
  } catch (e) {
    next(e);
  }
});

app.post('/api/state/reset', async (_req, res, next) => {
  try {
    if (!resetAllowed()) {
      res.status(403).json({ error: 'El reinicio de datos está desactivado en producción.' });
      return;
    }
    const state = await ops.reset();
    res.json({ state, metrics: ops.metricsSnapshot(state) });
  } catch (e) {
    next(e);
  }
});

app.patch('/api/settings', async (req, res, next) => {
  try {
    const state = await ops.updateSettings(req.body);
    res.json({ state, metrics: ops.metricsSnapshot(state) });
  } catch (e) {
    next(e);
  }
});

app.get('/api/suggest', async (req, res, next) => {
  try {
    const state = await ops.getState();
    const productId = String(req.query.productId ?? '');
    const qty = Number(req.query.qty ?? 1);
    const exclude = String(req.query.exclude ?? '');
    res.json(suggest(state, productId, qty, exclude));
  } catch (e) {
    next(e);
  }
});

app.get('/api/placement', async (req, res, next) => {
  try {
    const state = await ops.getState();
    const productId = String(req.query.productId ?? '');
    const qty = Number(req.query.qty ?? 1);
    const exclude = String(req.query.exclude ?? '');
    const options = suggestPlacement(state, productId, qty, exclude);
    const p = state.products.find((x) => x.id === productId);
    res.json({
      productId,
      qty,
      best: options[0] ?? null,
      options: options.slice(0, 8),
      guidance: options[0]
        ? `Ubica en ${options[0].id}: ${options[0].reasons.join(' · ')}`
        : 'No hay ubicación compatible para esta cantidad.',
      product: p
        ? { id: p.id, name: p.name, category: p.category, fragile: !!p.fragile, familyId: p.familyId }
        : null,
    });
  } catch (e) {
    next(e);
  }
});

app.get('/api/orders/:id/pick-plan', async (req, res, next) => {
  try {
    res.json(await ops.getPickPlan(req.params.id));
  } catch (e) {
    next(e);
  }
});

app.post('/api/receptions', async (req, res, next) => {
  try {
    const state = await ops.receiveGoods(req.body);
    res.json({ state, metrics: ops.metricsSnapshot(state) });
  } catch (e) {
    next(e);
  }
});

app.post('/api/moves', async (req, res, next) => {
  try {
    const state = await ops.transferLot(req.body);
    res.json({ state, metrics: ops.metricsSnapshot(state) });
  } catch (e) {
    next(e);
  }
});

app.post('/api/products', async (req, res, next) => {
  try {
    const state = await ops.saveProduct(req.body);
    res.json({ state, metrics: ops.metricsSnapshot(state) });
  } catch (e) {
    next(e);
  }
});

app.post('/api/vehicles', adminRequired, async (req, res, next) => {
  try {
    const state = await ops.saveVehicle(req.body ?? {});
    res.json({ state, metrics: ops.metricsSnapshot(state) });
  } catch (e) {
    next(e);
  }
});

app.delete('/api/vehicles/:id', adminRequired, async (req, res, next) => {
  try {
    const state = await ops.deleteVehicle(req.params.id);
    res.json({ state, metrics: ops.metricsSnapshot(state) });
  } catch (e) {
    next(e);
  }
});

app.post('/api/orders', async (req, res, next) => {
  try {
    await ops.placeOrder(req.body);
    const state = await ops.getState();
    res.json({ state, metrics: ops.metricsSnapshot(state) });
  } catch (e) {
    next(e);
  }
});

/** Importa factura XML: crea cliente/productos si faltan y genera el pedido */
app.post('/api/orders/from-xml', async (req, res, next) => {
  try {
    const xml = String(req.body?.xml ?? '');
    const importResult = await ops.importInvoiceXml(xml);
    const state = await ops.getState();
    res.status(201).json({
      state,
      metrics: ops.metricsSnapshot(state),
      import: importResult,
    });
  } catch (e) {
    next(e);
  }
});

/** Importa factura desde XML, PDF o Word (.docx) */
app.post('/api/orders/from-file', async (req, res, next) => {
  try {
    const importResult = await ops.importInvoiceFile({
      fileName: String(req.body?.fileName ?? ''),
      mimeType: String(req.body?.mimeType ?? ''),
      contentBase64: String(req.body?.contentBase64 ?? ''),
    });
    const state = await ops.getState();
    res.status(201).json({
      state,
      metrics: ops.metricsSnapshot(state),
      import: importResult,
    });
  } catch (e) {
    next(e);
  }
});

app.post('/api/orders/:id/prepare', async (req, res, next) => {
  try {
    const state = await ops.confirmPrepare(req.params.id, publicUserFromRequest(req));
    res.json({ state, metrics: ops.metricsSnapshot(state) });
  } catch (e) {
    next(e);
  }
});

app.post('/api/orders/:id/assign', adminRequired, async (req, res, next) => {
  try {
    const userId = String(req.body?.userId ?? '').trim();
    if (!userId) throw new Error('Indica el bodeguero (userId).');
    const assignee = getUserById(userId);
    if (!assignee) throw new Error('Usuario no encontrado.');
    const state = await ops.assignOrder(req.params.id, assignee, companyIdOf(req));
    res.json({ state, metrics: ops.metricsSnapshot(state) });
  } catch (e) {
    next(e);
  }
});

app.post('/api/orders/:id/unassign', adminRequired, async (req, res, next) => {
  try {
    const state = await ops.unassignOrder(req.params.id);
    res.json({ state, metrics: ops.metricsSnapshot(state) });
  } catch (e) {
    next(e);
  }
});

app.get('/api/users', adminRequired, (req, res, next) => {
  try {
    const rawRole = req.query.role ? String(req.query.role) : '';
    const role = (['admin', 'ops', 'dispatch', 'driver'] as AuthRole[]).includes(
      rawRole as AuthRole,
    )
      ? (rawRole as AuthRole)
      : undefined;
    const activeOnly =
      String(req.query.activeOnly ?? '') === '1' || String(req.query.activeOnly ?? '') === 'true';
    res.json({
      users: listUsers({
        companyId: companyIdOf(req),
        role,
        activeOnly,
      }),
    });
  } catch (e) {
    next(e);
  }
});

app.post('/api/users', adminRequired, (req, res, next) => {
  try {
    const user = createUser({
      email: String(req.body?.email ?? ''),
      name: String(req.body?.name ?? ''),
      password: String(req.body?.password ?? ''),
      role: String(req.body?.role ?? 'ops'),
      companyId: companyIdOf(req),
      truckPlate: req.body?.truckPlate !== undefined ? String(req.body.truckPlate) : undefined,
    });
    res.status(201).json({ user });
  } catch (e) {
    next(e);
  }
});

app.patch('/api/users/:id', adminRequired, (req, res, next) => {
  try {
    const existing = getUserById(req.params.id);
    if (!existing) throw new Error('Usuario no encontrado.');
    if (existing.companyId !== companyIdOf(req) && existing.id !== req.user?.id) {
      throw new Error('Usuario de otra empresa.');
    }
    const user = updateUser(req.params.id, {
      email: req.body?.email !== undefined ? String(req.body.email) : undefined,
      name: req.body?.name !== undefined ? String(req.body.name) : undefined,
      password: req.body?.password !== undefined ? String(req.body.password) : undefined,
      role: req.body?.role !== undefined ? String(req.body.role) : undefined,
      truckPlate:
        req.body?.truckPlate !== undefined
          ? req.body.truckPlate === null
            ? null
            : String(req.body.truckPlate)
          : undefined,
      active: req.body?.active !== undefined ? Boolean(req.body.active) : undefined,
    });
    res.json({ user });
  } catch (e) {
    next(e);
  }
});

app.delete('/api/users/:id', adminRequired, (req, res, next) => {
  try {
    const existing = getUserById(req.params.id);
    if (!existing) throw new Error('Usuario no encontrado.');
    if (existing.companyId !== companyIdOf(req)) throw new Error('Usuario de otra empresa.');
    if (existing.id === req.user?.id) throw new Error('No puedes desactivar tu propio usuario.');
    const user = deactivateUser(req.params.id);
    res.json({ user });
  } catch (e) {
    next(e);
  }
});

app.post('/api/dispatch', async (req, res, next) => {
  try {
    const { orderIds, vehicle } = req.body as { orderIds: string[]; vehicle?: string };
    const plate = String(vehicle || 'GBA-2041').trim().toUpperCase();
    const truck = fleetForCompany(companyIdOf(req)).find(
      (t) => t.plate.toUpperCase() === plate,
    );
    const state = await ops.confirmDispatch(
      orderIds,
      plate,
      truck ? { maxKg: truck.maxKg, maxM3: truck.maxM3 } : undefined,
    );
    res.json({ state, metrics: ops.metricsSnapshot(state) });
  } catch (e) {
    next(e);
  }
});

app.post('/api/logistics/auto-assign', authRequired, async (req, res, next) => {
  try {
    const state = await ops.getState();
    const body = (req.body ?? {}) as {
      orderIds?: string[];
      stagedByTruck?: Record<string, string[]>;
      fleet?: Array<{
        id: string;
        plate: string;
        label: string;
        city: string;
        driver: string;
        allowedSectors?: string[];
        maxKg: number;
        maxM3: number;
        costPerKm: number;
      }>;
    };
    const plan = await autoAssignLogistics({
      state,
      orderIds: body.orderIds,
      stagedByTruck: body.stagedByTruck,
      fleet: body.fleet,
    });
    res.json({ plan, openai: openaiConfigured() });
  } catch (e) {
    next(e);
  }
});

app.get('/api/logistics/ai-status', authRequired, (_req, res) => {
  res.json({
    openai: openaiConfigured(),
    model: process.env.OPENAI_MODEL || process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
  });
});

app.post('/api/delivery', async (req, res, next) => {
  try {
    const { orderId, person, notes, code } = req.body;
    const state = await ops.delivery(orderId, person, notes, code);
    res.json({ state, metrics: ops.metricsSnapshot(state) });
  } catch (e) {
    next(e);
  }
});

app.post('/api/delivery/skip', async (req, res, next) => {
  try {
    const state = await ops.skipStop(String(req.body?.orderId ?? ''));
    res.json({ state, metrics: ops.metricsSnapshot(state) });
  } catch (e) {
    next(e);
  }
});

app.get('/api/public/delivery-code', async (req, res, next) => {
  try {
    res.json(await ops.deliveryCode(String(req.query.orderId ?? ''), String(req.query.k ?? '')));
  } catch (e) {
    next(e);
  }
});

app.post('/api/incidents', async (req, res, next) => {
  try {
    const { orderId, reason, notes } = req.body;
    const state = await ops.incident(orderId, reason, notes);
    res.json({ state, metrics: ops.metricsSnapshot(state) });
  } catch (e) {
    next(e);
  }
});

app.post('/api/clients', async (req, res, next) => {
  try {
    const state = await ops.addClient(req.body);
    res.json({ state, metrics: ops.metricsSnapshot(state) });
  } catch (e) {
    next(e);
  }
});

app.patch('/api/clients/:id', async (req, res, next) => {
  try {
    const state = await ops.updateClient(req.params.id, req.body ?? {});
    res.json({ state, metrics: ops.metricsSnapshot(state) });
  } catch (e) {
    next(e);
  }
});

app.post('/api/purchases', async (req, res, next) => {
  try {
    const state = await ops.addPurchase(req.body);
    res.json({ state, metrics: ops.metricsSnapshot(state) });
  } catch (e) {
    next(e);
  }
});

app.post('/api/orders/:id/cancel', async (req, res, next) => {
  try {
    const state = await ops.cancelClientOrder(req.params.id, String(req.body?.reason ?? ''));
    res.json({ state, metrics: ops.metricsSnapshot(state) });
  } catch (e) {
    next(e);
  }
});

app.post('/api/purchases/:id/receive', async (req, res, next) => {
  try {
    const state = await ops.receivePurchaseOrder(req.params.id, req.body ?? { lines: [] });
    res.json({ state, metrics: ops.metricsSnapshot(state) });
  } catch (e) {
    next(e);
  }
});

app.post('/api/purchases/:id/close', async (req, res, next) => {
  try {
    const state = await ops.closePurchaseOrder(req.params.id, String(req.body?.reason ?? ''));
    res.json({ state, metrics: ops.metricsSnapshot(state) });
  } catch (e) {
    next(e);
  }
});

app.post('/api/lots/:id/release', async (req, res, next) => {
  try {
    const state = await ops.releaseInspectedLot(req.params.id);
    res.json({ state, metrics: ops.metricsSnapshot(state) });
  } catch (e) {
    next(e);
  }
});

app.post('/api/lots/:id/reject', async (req, res, next) => {
  try {
    const state = await ops.rejectInspectedLot(req.params.id, String(req.body?.reason ?? ''));
    res.json({ state, metrics: ops.metricsSnapshot(state) });
  } catch (e) {
    next(e);
  }
});

app.post('/api/purchases/:id/cancel', async (req, res, next) => {
  try {
    const state = await ops.cancelPurchaseOrder(req.params.id);
    res.json({ state, metrics: ops.metricsSnapshot(state) });
  } catch (e) {
    next(e);
  }
});

app.post('/api/suppliers', async (req, res, next) => {
  try {
    const state = await ops.addSupplier(req.body ?? {});
    res.json({ state, metrics: ops.metricsSnapshot(state) });
  } catch (e) {
    next(e);
  }
});

app.patch('/api/suppliers/:id', async (req, res, next) => {
  try {
    const state = await ops.editSupplier(req.params.id, req.body ?? {});
    res.json({ state, metrics: ops.metricsSnapshot(state) });
  } catch (e) {
    next(e);
  }
});

app.post('/api/bundles', async (req, res, next) => {
  try {
    const state = await ops.saveBundle(req.body ?? {});
    res.json({ state, metrics: ops.metricsSnapshot(state) });
  } catch (e) {
    next(e);
  }
});

app.delete('/api/bundles/:id', async (req, res, next) => {
  try {
    const state = await ops.removeBundle(req.params.id);
    res.json({ state, metrics: ops.metricsSnapshot(state) });
  } catch (e) {
    next(e);
  }
});

app.post('/api/bundles/:id/assemble', async (req, res, next) => {
  try {
    const state = await ops.assembleKit({ ...req.body, bundleId: req.params.id });
    res.json({ state, metrics: ops.metricsSnapshot(state) });
  } catch (e) {
    next(e);
  }
});

app.post('/api/imports/preview', async (req, res, next) => {
  try {
    res.json(await ops.previewImport(req.body ?? {}));
  } catch (e) {
    next(e);
  }
});

app.post('/api/imports/commit', async (req, res, next) => {
  try {
    const result = await ops.commitImport(req.body ?? {});
    res.status(201).json({
      state: result.state,
      metrics: ops.metricsSnapshot(result.state),
      import: result.import,
    });
  } catch (e) {
    next(e);
  }
});

app.post('/api/families', async (req, res, next) => {
  try {
    const state = await ops.saveFamily(req.body);
    res.json({ state, metrics: ops.metricsSnapshot(state) });
  } catch (e) {
    next(e);
  }
});

app.delete('/api/families/:id', async (req, res, next) => {
  try {
    const state = await ops.removeFamily(req.params.id);
    res.json({ state, metrics: ops.metricsSnapshot(state) });
  } catch (e) {
    next(e);
  }
});

app.post('/api/warehouses', async (req, res, next) => {
  try {
    const state = await ops.addWarehouse(req.body);
    res.json({ state, metrics: ops.metricsSnapshot(state) });
  } catch (e) {
    next(e);
  }
});

app.patch('/api/warehouses/:id', async (req, res, next) => {
  try {
    const state = await ops.saveWarehouse({ ...req.body, id: req.params.id });
    res.json({ state, metrics: ops.metricsSnapshot(state) });
  } catch (e) {
    next(e);
  }
});

app.delete('/api/warehouses/:id', async (req, res, next) => {
  try {
    const state = await ops.removeWarehouse(req.params.id);
    res.json({ state, metrics: ops.metricsSnapshot(state) });
  } catch (e) {
    next(e);
  }
});

app.post('/api/warehouses/:id/activate', async (req, res, next) => {
  try {
    const state = await ops.setActiveWarehouse(req.params.id);
    res.json({ state, metrics: ops.metricsSnapshot(state) });
  } catch (e) {
    next(e);
  }
});

app.get('/api/assistant/:query', async (req, res, next) => {
  try {
    const q = req.params.query as 'stock' | 'warehouse' | 'orders';
    res.json({ lines: await ops.assistantQuery(q) });
  } catch (e) {
    next(e);
  }
});

/** Menú dinámico según módulos de la empresa del usuario */
app.get('/api/menu', authRequired, (req, res, next) => {
  try {
    const companyId = String(req.query.companyId || req.user?.companyId || 'co-innovamf');
    res.json(menuForCompany(companyId));
  } catch (e) {
    next(e);
  }
});

/** Flota activa de la empresa (web + ops-mobile) */
app.get('/api/fleet', authRequired, (req, res, next) => {
  try {
    const companyId = String(req.query.companyId || req.user?.companyId || companyIdOf(req));
    res.json({ trucks: fleetForCompany(companyId) });
  } catch (e) {
    next(e);
  }
});

/** Gestión de flota de la empresa del usuario (incluye inactivos) */
app.get('/api/fleet/manage', authRequired, (req, res, next) => {
  try {
    res.json({
      vehicles: listVehicles(companyIdOf(req)).map((v) => vehicleDto(v)),
    });
  } catch (e) {
    next(e);
  }
});

app.post('/api/fleet', authRequired, (req, res, next) => {
  try {
    const vehicle = createVehicle(companyIdOf(req), {
      plate: String(req.body?.plate ?? ''),
      label: String(req.body?.label ?? ''),
      vehicleType: req.body?.vehicleType ? String(req.body.vehicleType) : undefined,
      city: req.body?.city ? String(req.body.city) : undefined,
      driver: req.body?.driver ? String(req.body.driver) : undefined,
      maxKg: typeof req.body?.maxKg === 'number' ? req.body.maxKg : undefined,
      maxM3: typeof req.body?.maxM3 === 'number' ? req.body.maxM3 : undefined,
      costPerKm: typeof req.body?.costPerKm === 'number' ? req.body.costPerKm : undefined,
      etaHours: typeof req.body?.etaHours === 'number' ? req.body.etaHours : undefined,
      routeKm: typeof req.body?.routeKm === 'number' ? req.body.routeKm : undefined,
      allowedSectors: sectorsFromBody(req.body),
    });
    res.status(201).json({
      vehicle: vehicleDto(vehicle),
      trucks: fleetForCompany(companyIdOf(req)),
    });
  } catch (e) {
    next(e);
  }
});

app.patch('/api/fleet/:id', authRequired, (req, res, next) => {
  try {
    assertVehicleOfCompany(req.params.id, companyIdOf(req));
    const vehicle = updateVehicle(req.params.id, {
      plate: req.body?.plate ? String(req.body.plate) : undefined,
      label: req.body?.label ? String(req.body.label) : undefined,
      vehicleType: req.body?.vehicleType ? String(req.body.vehicleType) : undefined,
      city: req.body?.city !== undefined ? String(req.body.city) : undefined,
      driver: req.body?.driver !== undefined ? String(req.body.driver) : undefined,
      maxKg: typeof req.body?.maxKg === 'number' ? req.body.maxKg : undefined,
      maxM3: typeof req.body?.maxM3 === 'number' ? req.body.maxM3 : undefined,
      costPerKm: typeof req.body?.costPerKm === 'number' ? req.body.costPerKm : undefined,
      etaHours: typeof req.body?.etaHours === 'number' ? req.body.etaHours : undefined,
      routeKm: typeof req.body?.routeKm === 'number' ? req.body.routeKm : undefined,
      allowedSectors: sectorsFromBody(req.body),
      active: typeof req.body?.active === 'boolean' ? req.body.active : undefined,
    });
    res.json({ vehicle: vehicleDto(vehicle), trucks: fleetForCompany(companyIdOf(req)) });
  } catch (e) {
    next(e);
  }
});

app.delete('/api/fleet/:id', authRequired, (req, res, next) => {
  try {
    assertVehicleOfCompany(req.params.id, companyIdOf(req));
    deleteVehicle(req.params.id);
    res.json({ ok: true, trucks: fleetForCompany(companyIdOf(req)) });
  } catch (e) {
    next(e);
  }
});

/** Roles móviles habilitados para la empresa */
app.get('/api/mobile/config', authRequired, (req, res, next) => {
  try {
    const companyId = String(req.query.companyId || req.user?.companyId || companyIdOf(req));
    res.json(mobileConfigForCompany(companyId));
  } catch (e) {
    next(e);
  }
});

app.get('/api/admin/companies', adminRequired, (_req, res, next) => {
  try {
    res.json({ companies: listCompanies() });
  } catch (e) {
    next(e);
  }
});

app.post('/api/admin/companies', adminRequired, (req, res, next) => {
  try {
    const company = createCompany({
      name: String(req.body?.name ?? ''),
      slug: req.body?.slug ? String(req.body.slug) : undefined,
    });
    res.status(201).json({ company });
  } catch (e) {
    next(e);
  }
});

app.patch('/api/admin/companies/:id', adminRequired, (req, res, next) => {
  try {
    const company = updateCompany(req.params.id, {
      name: req.body?.name ? String(req.body.name) : undefined,
      active: typeof req.body?.active === 'boolean' ? req.body.active : undefined,
    });
    res.json({ company });
  } catch (e) {
    next(e);
  }
});

app.get('/api/admin/companies/:id/modules', adminRequired, (req, res, next) => {
  try {
    res.json({
      moduleIds: companyModuleIds(req.params.id),
      modules: listAllModules(),
    });
  } catch (e) {
    next(e);
  }
});

app.put('/api/admin/companies/:id/modules', adminRequired, (req, res, next) => {
  try {
    const moduleIds = Array.isArray(req.body?.moduleIds)
      ? req.body.moduleIds.map((x: unknown) => String(x))
      : [];
    const saved = setCompanyModules(req.params.id, moduleIds);
    res.json({ moduleIds: saved, menu: menuForCompany(req.params.id) });
  } catch (e) {
    next(e);
  }
});

app.get('/api/admin/companies/:id/mobile-roles', adminRequired, (req, res, next) => {
  try {
    res.json({
      roleIds: companyMobileRoleIds(req.params.id),
      roles: listMobileRoles(),
    });
  } catch (e) {
    next(e);
  }
});

app.put('/api/admin/companies/:id/mobile-roles', adminRequired, (req, res, next) => {
  try {
    const roleIds = Array.isArray(req.body?.roleIds)
      ? req.body.roleIds.map((x: unknown) => String(x))
      : [];
    const saved = setCompanyMobileRoles(req.params.id, roleIds);
    res.json({ roleIds: saved, config: mobileConfigForCompany(req.params.id) });
  } catch (e) {
    next(e);
  }
});

app.get('/api/admin/companies/:id/vehicles', adminRequired, (req, res, next) => {
  try {
    res.json({ vehicles: listVehicles(req.params.id).map((v) => vehicleDto(v)) });
  } catch (e) {
    next(e);
  }
});

app.post('/api/admin/companies/:id/vehicles', adminRequired, (req, res, next) => {
  try {
    const vehicle = createVehicle(req.params.id, {
      plate: String(req.body?.plate ?? ''),
      label: String(req.body?.label ?? ''),
      vehicleType: req.body?.vehicleType ? String(req.body.vehicleType) : undefined,
      city: req.body?.city ? String(req.body.city) : undefined,
      driver: req.body?.driver ? String(req.body.driver) : undefined,
      maxKg: typeof req.body?.maxKg === 'number' ? req.body.maxKg : undefined,
      maxM3: typeof req.body?.maxM3 === 'number' ? req.body.maxM3 : undefined,
      costPerKm: typeof req.body?.costPerKm === 'number' ? req.body.costPerKm : undefined,
      etaHours: typeof req.body?.etaHours === 'number' ? req.body.etaHours : undefined,
      routeKm: typeof req.body?.routeKm === 'number' ? req.body.routeKm : undefined,
      allowedSectors: sectorsFromBody(req.body),
    });
    res.status(201).json({ vehicle: vehicleDto(vehicle) });
  } catch (e) {
    next(e);
  }
});

app.patch('/api/admin/vehicles/:id', adminRequired, (req, res, next) => {
  try {
    const vehicle = updateVehicle(req.params.id, {
      plate: req.body?.plate ? String(req.body.plate) : undefined,
      label: req.body?.label ? String(req.body.label) : undefined,
      vehicleType: req.body?.vehicleType ? String(req.body.vehicleType) : undefined,
      city: req.body?.city !== undefined ? String(req.body.city) : undefined,
      driver: req.body?.driver !== undefined ? String(req.body.driver) : undefined,
      maxKg: typeof req.body?.maxKg === 'number' ? req.body.maxKg : undefined,
      maxM3: typeof req.body?.maxM3 === 'number' ? req.body.maxM3 : undefined,
      costPerKm: typeof req.body?.costPerKm === 'number' ? req.body.costPerKm : undefined,
      etaHours: typeof req.body?.etaHours === 'number' ? req.body.etaHours : undefined,
      allowedSectors: sectorsFromBody(req.body),
      routeKm: typeof req.body?.routeKm === 'number' ? req.body.routeKm : undefined,
      active: typeof req.body?.active === 'boolean' ? req.body.active : undefined,
    });
    res.json({ vehicle: vehicleDto(vehicle) });
  } catch (e) {
    next(e);
  }
});

app.delete('/api/admin/vehicles/:id', adminRequired, (req, res, next) => {
  try {
    res.json(deleteVehicle(req.params.id));
  } catch (e) {
    next(e);
  }
});

app.get('/api/admin/modules', adminRequired, (_req, res, next) => {
  try {
    res.json({ modules: listModules() });
  } catch (e) {
    next(e);
  }
});

app.get('/api/admin/mobile-roles', adminRequired, (_req, res, next) => {
  try {
    res.json({ roles: listMobileRoles() });
  } catch (e) {
    next(e);
  }
});

app.get('/api/admin/menu', adminRequired, (_req, res, next) => {
  try {
    res.json({ items: listMenuItems() });
  } catch (e) {
    next(e);
  }
});

app.patch('/api/admin/menu/:id', adminRequired, (req, res, next) => {
  try {
    const item = updateMenuItem(req.params.id, {
      label: req.body?.label ? String(req.body.label) : undefined,
      path: req.body?.path ? String(req.body.path) : undefined,
      icon: req.body?.icon ? String(req.body.icon) : undefined,
      section: req.body?.section ? String(req.body.section) : undefined,
      sort_order: typeof req.body?.sort_order === 'number' ? req.body.sort_order : undefined,
      badge: req.body?.badge === null ? null : req.body?.badge ? String(req.body.badge) : undefined,
      active: typeof req.body?.active === 'boolean' ? req.body.active : undefined,
    });
    res.json({ item });
  } catch (e) {
    next(e);
  }
});

function stateJson(res: express.Response, state: Awaited<ReturnType<typeof ops.getState>>) {
  res.json({ state, metrics: ops.metricsSnapshot(state) });
}

app.post('/api/invoices', async (req, res, next) => {
  try {
    stateJson(res, await ops.issueSalesInvoice(String(req.body?.orderId ?? '')));
  } catch (e) {
    next(e);
  }
});

app.post('/api/credit-notes', async (req, res, next) => {
  try {
    stateJson(res, await ops.issueSalesCreditNote(req.body));
  } catch (e) {
    next(e);
  }
});

app.post('/api/guides', async (req, res, next) => {
  try {
    stateJson(res, await ops.issueDeliveryGuide(req.body));
  } catch (e) {
    next(e);
  }
});

app.post('/api/payments', async (req, res, next) => {
  try {
    stateJson(res, await ops.collectInvoice(req.body));
  } catch (e) {
    next(e);
  }
});

app.post('/api/supplier-bills', async (req, res, next) => {
  try {
    stateJson(res, await ops.billSupplier(req.body));
  } catch (e) {
    next(e);
  }
});

app.post('/api/supplier-payments', async (req, res, next) => {
  try {
    stateJson(res, await ops.paySupplier(req.body));
  } catch (e) {
    next(e);
  }
});

app.post('/api/price-lists', async (req, res, next) => {
  try {
    stateJson(res, await ops.savePriceList(req.body));
  } catch (e) {
    next(e);
  }
});

app.post('/api/client-prices', async (req, res, next) => {
  try {
    stateJson(res, await ops.saveClientPrice(req.body));
  } catch (e) {
    next(e);
  }
});

app.post('/api/adjustments', async (req, res, next) => {
  try {
    stateJson(res, await ops.requestStockAdjustment(req.body));
  } catch (e) {
    next(e);
  }
});

app.post('/api/adjustments/:id/approve', async (req, res, next) => {
  try {
    stateJson(res, await ops.approveStockAdjustment(req.params.id));
  } catch (e) {
    next(e);
  }
});

app.post('/api/supplier-returns', async (req, res, next) => {
  try {
    stateJson(res, await ops.returnStockToSupplier(req.body));
  } catch (e) {
    next(e);
  }
});

app.post('/api/cycle-counts', async (req, res, next) => {
  try {
    stateJson(res, await ops.startCycleCount());
  } catch (e) {
    next(e);
  }
});

app.post('/api/cycle-counts/:id/apply', async (req, res, next) => {
  try {
    stateJson(res, await ops.applyStockCount({ id: req.params.id, lines: req.body?.lines ?? [] }));
  } catch (e) {
    next(e);
  }
});

app.post('/api/transfers', async (req, res, next) => {
  try {
    stateJson(res, await ops.shipWarehouseTransfer(req.body));
  } catch (e) {
    next(e);
  }
});

app.post('/api/transfers/:id/receive', async (req, res, next) => {
  try {
    stateJson(res, await ops.receiveWarehouseTransfer({ id: req.params.id, lines: req.body?.lines ?? [] }));
  } catch (e) {
    next(e);
  }
});

app.get('/api/replenishment', async (_req, res, next) => {
  try {
    res.json({ groups: await ops.replenishment() });
  } catch (e) {
    next(e);
  }
});

app.post('/api/replenishment', async (_req, res, next) => {
  try {
    stateJson(res, await ops.createReplenishment());
  } catch (e) {
    next(e);
  }
});

app.get('/api/plan', async (_req, res, next) => {
  try {
    res.json(await ops.plan());
  } catch (e) {
    next(e);
  }
});

app.post('/api/plan/:id/approve', async (req, res, next) => {
  try {
    stateJson(res, await ops.approvePlan(req.params.id));
  } catch (e) {
    next(e);
  }
});

app.post('/api/plan/:id/discard', async (req, res, next) => {
  try {
    stateJson(res, await ops.discardPlan(req.params.id, req.body?.note));
  } catch (e) {
    next(e);
  }
});

app.post('/api/plan/:id/undo', async (req, res, next) => {
  try {
    stateJson(res, await ops.undoPlan(req.params.id));
  } catch (e) {
    next(e);
  }
});

app.post('/api/quotes', async (req, res, next) => {
  try {
    stateJson(res, await ops.addQuote(req.body ?? {}));
  } catch (e) {
    next(e);
  }
});

app.post('/api/quotes/:id/win', async (req, res, next) => {
  try {
    stateJson(res, await ops.winQuote(req.params.id));
  } catch (e) {
    next(e);
  }
});

app.post('/api/quotes/:id/lose', async (req, res, next) => {
  try {
    stateJson(res, await ops.loseQuote(req.params.id));
  } catch (e) {
    next(e);
  }
});

app.post('/api/packing', async (req, res, next) => {
  try {
    stateJson(res, await ops.pack(String(req.body?.orderId ?? ''), Number(req.body?.weightKg), Number(req.body?.volumeM3)));
  } catch (e) {
    next(e);
  }
});

app.post('/api/loading/preview', async (req, res, next) => {
  try {
    res.json(await ops.previewLoad(String(req.body?.plate ?? ''), Array.isArray(req.body?.orderIds) ? req.body.orderIds.map(String) : []));
  } catch (e) {
    next(e);
  }
});

app.post('/api/offerings', async (req, res, next) => {
  try {
    stateJson(res, await ops.addOffering(req.body ?? {}));
  } catch (e) {
    next(e);
  }
});

app.delete('/api/offerings/:id', async (req, res, next) => {
  try {
    stateJson(res, await ops.deleteOffering(req.params.id));
  } catch (e) {
    next(e);
  }
});

app.post('/api/products/read-label', (req, res, next) => {
  try {
    res.json(readLabel(String(req.body?.text ?? '')));
  } catch (e) {
    next(e);
  }
});

app.get('/api/reports/:kind', async (req, res, next) => {
  try {
    const kind = req.params.kind === 'diagnostics' ? 'diagnostics' : req.params.kind === 'traceability' ? 'traceability' : '';
    const format = req.query.format === 'pdf' ? 'pdf' : req.query.format === 'xlsx' ? 'xlsx' : '';
    if (!kind || !format) {
      res.status(400).json({ error: 'Usa traceability o diagnostics, en xlsx o pdf.' });
      return;
    }
    const state = await repo.load();
    const file = await renderReport(state, kind, format);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.end(file.buffer);
  } catch (e) {
    next(e);
  }
});

app.get('/api/recall', async (req, res, next) => {
  try {
    res.json(await ops.recall(String(req.query.batch ?? '')));
  } catch (e) {
    next(e);
  }
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : 'Error interno';
  res.status(400).json({ error: message });
});

// Inicializa SQLite (menú / módulos / empresas)
getAdminDb();
// Respaldo diario de usuarios y de la base de empresas, junto a los del estado.
scheduleAuthBackups(repo.backupsDir);
if (isProd() && !resetAllowed()) console.log('[state] Reinicio de datos desactivado (producción).');

const PORT = Number(process.env.PORT ?? 3001);
app.listen(PORT, () => {
  console.log(`OPTICLEAN API en http://localhost:${PORT}`);
});
