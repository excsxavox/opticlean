import cors from 'cors';
import express from 'express';
import { OperationsUseCases } from '../../application/use-cases/OperationsUseCases.js';
import { authRequired } from '../auth/auth.js';
import { runAs } from '../../domain/request-context.js';
import { carriesState, stateForUser } from './state-view.js';
import type { RouteContext } from './context.js';
import type { StateRepository } from '../../application/ports/StateRepository.js';
import { roleDenied, PUBLIC_API_PATHS } from './access.js';
import { isProd } from './env.js';
import { registerAuthRoutes } from './auth.routes.js';
import { registerOperationsRoutes } from './operations.routes.js';
import { registerUserRoutes } from './users.routes.js';
import { registerFleetRoutes } from './fleet.routes.js';
import { registerAdminRoutes } from './admin.routes.js';
import { registerCommercialRoutes } from './commercial.routes.js';

export function createApp(repo: StateRepository) {
  const app = express();
  const ops = new OperationsUseCases(repo);
  const ctx: RouteContext = { ops, repo };

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

  app.use((req, res, next) => {
    if (!req.path.startsWith('/api/')) return next();
    if (PUBLIC_API_PATHS.has(req.path)) return next();
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

  registerAuthRoutes(app);
  registerOperationsRoutes(app, ctx);
  registerUserRoutes(app);
  registerFleetRoutes(app);
  registerAdminRoutes(app);
  registerCommercialRoutes(app, ctx);

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = err instanceof Error ? err.message : 'Error interno';
    res.status(400).json({ error: message });
  });

  return app;
}
