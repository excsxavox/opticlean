import express from 'express';
import { adminRequired, createUser, deactivateUser, getUserById, listUsers, updateUser, type AuthRole } from '../auth/auth.js';
import { companyIdOf } from './helpers.js';

export function registerUserRoutes(app: express.Express) {
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
}
