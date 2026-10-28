import cors from 'cors';
import express from 'express';
import { JsonStateRepository } from '../persistence/JsonStateRepository.js';
import { OperationsUseCases } from '../../application/use-cases/OperationsUseCases.js';
import { suggest } from '../../domain/inventory.service.js';

const app = express();
const repo = new JsonStateRepository();
const ops = new OperationsUseCases(repo);

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ ok: true }));

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
