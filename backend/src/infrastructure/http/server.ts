import cors from 'cors';
import express from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JsonStateRepository } from '../persistence/JsonStateRepository.js';
import { OperationsUseCases } from '../../application/use-cases/OperationsUseCases.js';
import { suggest, suggestPlacement } from '../../domain/placement.service.js';
import { autoAssignLogistics, openaiConfigured } from '../../domain/logistics-ai.service.js';
import { authRequired, login, publicUserFromRequest } from '../auth/auth.js';

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

const app = express();
const repo = new JsonStateRepository();
const ops = new OperationsUseCases(repo);

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.post('/api/auth/login', (req, res) => {
  try {
    const email = String(req.body?.email ?? '');
    const password = String(req.body?.password ?? '');
    if (!email || !password) {
      res.status(400).json({ error: 'Ingresa correo y contraseña' });
      return;
    }
    res.json(login(email, password));
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

app.post('/api/orders', async (req, res, next) => {
  try {
    await ops.placeOrder(req.body);
    const state = await ops.getState();
    res.json({ state, metrics: ops.metricsSnapshot(state) });
  } catch (e) {
    next(e);
  }
});

app.post('/api/orders/:id/prepare', async (req, res, next) => {
  try {
    const state = await ops.confirmPrepare(req.params.id);
    res.json({ state, metrics: ops.metricsSnapshot(state) });
  } catch (e) {
    next(e);
  }
});

app.post('/api/dispatch', async (req, res, next) => {
  try {
    const { orderIds, vehicle } = req.body as { orderIds: string[]; vehicle?: string };
    const state = await ops.confirmDispatch(orderIds, vehicle);
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
    const { orderId, person, notes } = req.body;
    const state = await ops.delivery(orderId, person, notes);
    res.json({ state, metrics: ops.metricsSnapshot(state) });
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

app.post('/api/purchases', async (req, res, next) => {
  try {
    const state = await ops.addPurchase(req.body);
    res.json({ state, metrics: ops.metricsSnapshot(state) });
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

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : 'Error interno';
  res.status(400).json({ error: message });
});

const PORT = Number(process.env.PORT ?? 3001);
app.listen(PORT, () => {
  console.log(`OPTICLEAN API en http://localhost:${PORT}`);
});
