import { companyIdOf } from './helpers.js';
import { fleetForCompany } from '../../domain/admin.service.js';
import express from 'express';
import { readLabel } from '../../domain/outbound.service.js';
import { renderReport } from '../../domain/report-file.js';
import type { RouteContext } from './context.js';

export function registerCommercialRoutes(app: express.Express, { ops, repo }: RouteContext) {
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

  app.post('/api/packing/parcels', async (req, res, next) => {
    try {
      stateJson(res, await ops.addParcel(req.body ?? {}));
    } catch (e) {
      next(e);
    }
  });

  app.patch('/api/packing/parcels/:id', async (req, res, next) => {
    try {
      stateJson(res, await ops.editParcel(req.params.id, req.body ?? {}));
    } catch (e) {
      next(e);
    }
  });

  app.delete('/api/packing/parcels/:id', async (req, res, next) => {
    try {
      stateJson(res, await ops.removeParcel(req.params.id));
    } catch (e) {
      next(e);
    }
  });

  app.post('/api/packing/orders/:id/count', async (req, res, next) => {
    try {
      stateJson(res, await ops.countPackedUnits(req.params.id, req.body ?? {}));
    } catch (e) {
      next(e);
    }
  });

  app.post('/api/packing/orders/:id/scan', async (req, res, next) => {
    try {
      const { state, scanned } = await ops.scanPackedUnit(req.params.id, String(req.body?.code ?? ''));
      res.json({ state, metrics: ops.metricsSnapshot(state), scanned });
    } catch (e) {
      next(e);
    }
  });

  for (const [file, kind] of [
    ['labels.pdf', 'labels'],
    ['list.pdf', 'list'],
  ] as const) {
    app.get(`/api/packing/orders/:id/${file}`, async (req, res, next) => {
      try {
        const doc = await ops.packingDocument(String(req.params.id), kind);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${doc.filename}"`);
        res.end(doc.buffer);
      } catch (e) {
        next(e);
      }
    });
  }

  app.post('/api/packing/orders/:id/close', async (req, res, next) => {
    try {
      stateJson(res, await ops.closeOrderPacking(req.params.id));
    } catch (e) {
      next(e);
    }
  });

  app.post('/api/packing/orders/:id/reopen', async (req, res, next) => {
    try {
      stateJson(res, await ops.reopenOrderPacking(req.params.id));
    } catch (e) {
      next(e);
    }
  });

  const idList = (value: unknown) => (Array.isArray(value) ? value.map(String) : []);

  app.post('/api/loading/preview', async (req, res, next) => {
    try {
      res.json(
        await ops.previewLoad(String(req.body?.plate ?? ''), idList(req.body?.orderIds), fleetForCompany(companyIdOf(req))),
      );
    } catch (e) {
      next(e);
    }
  });

  app.post('/api/loading/confirm', async (req, res, next) => {
    try {
      stateJson(
        res,
        await ops.confirmTruckLoad(
          {
            plate: String(req.body?.plate ?? ''),
            orderIds: idList(req.body?.orderIds),
            reason: String(req.body?.reason ?? ''),
          },
          fleetForCompany(companyIdOf(req)),
        ),
      );
    } catch (e) {
      next(e);
    }
  });

  app.post('/api/loading/release', async (req, res, next) => {
    try {
      stateJson(res, await ops.releaseTruckLoad(String(req.body?.plate ?? '')));
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
}
