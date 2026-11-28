import express from 'express';
import { suggest, suggestPlacement } from '../../domain/placement.service.js';
import { autoAssignLogistics, openaiConfigured } from '../../domain/logistics-ai.service.js';
import { adminRequired, authRequired, getUserById, publicUserFromRequest } from '../auth/auth.js';
import { deleteVehicle, fleetForCompany, recordDispatchKm } from '../../domain/admin.service.js';
import type { RouteContext } from './context.js';
import { companyIdOf } from './helpers.js';
import { isProd, resetAllowed } from './env.js';
import { PUBLIC_API_PATHS } from './access.js';

export function registerOperationsRoutes(app: express.Express, { ops }: RouteContext) {
  app.use('/api', (req, res, next) => {
    if (PUBLIC_API_PATHS.has(`/api${req.path}`)) return next();
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

  app.post('/api/receptions/batch', async (req, res, next) => {
    try {
      const state = await ops.receiveGoodsBatch(req.body);
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

  app.post('/api/dispatch', async (req, res, next) => {
    try {
      const { orderIds, vehicle } = req.body as { orderIds: string[]; vehicle?: string };
      const plate = String(vehicle || 'GBA-2041').trim().toUpperCase();
      const companyId = companyIdOf(req);
      const truck = fleetForCompany(companyId).find((t) => t.plate.toUpperCase() === plate);
      const ids = Array.isArray(orderIds) ? orderIds.map(String) : [];
      const state = await ops.confirmDispatch(
        ids,
        plate,
        truck ? { maxKg: truck.maxKg, maxM3: truck.maxM3 } : undefined,
        fleetForCompany(companyId),
      );
      let kmLog = null;
      try {
        kmLog = recordDispatchKm(companyId, plate, ids.length, ids, state.settings);
      } catch {
        /* el despacho ya quedó; el odómetro no debe tumbar la operación */
      }
      res.json({
        state,
        metrics: ops.metricsSnapshot(state),
        km: kmLog
          ? {
              added: kmLog.log.km,
              odometerKm: kmLog.log.odometerAfter,
              plate: kmLog.log.plate,
            }
          : null,
        trucks: fleetForCompany(companyId),
      });
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

  app.patch('/api/orders/:id', async (req, res, next) => {
    try {
      const state = await ops.editClientOrder(req.params.id, req.body ?? {});
      res.json({ state, metrics: ops.metricsSnapshot(state) });
    } catch (e) {
      next(e);
    }
  });

  app.patch('/api/purchases/:id', async (req, res, next) => {
    try {
      const state = await ops.editPurchaseOrder(req.params.id, req.body ?? {});
      res.json({ state, metrics: ops.metricsSnapshot(state) });
    } catch (e) {
      next(e);
    }
  });

  app.delete('/api/clients/:id', async (req, res, next) => {
    try {
      const state = await ops.removeClient(req.params.id);
      res.json({ state, metrics: ops.metricsSnapshot(state) });
    } catch (e) {
      next(e);
    }
  });

  app.delete('/api/products/:id', async (req, res, next) => {
    try {
      const state = await ops.removeProduct(req.params.id);
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
}
