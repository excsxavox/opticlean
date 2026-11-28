import express from 'express';
import { platformAdminRequired } from '../auth/auth.js';
import { companyMobileRoleIds, companyModuleIds, createCompany, createVehicle, deleteVehicle, listAllModules, listCompanies, listMenuItems, listMobileRoles, listModules, listVehicles, menuForCompany, mobileConfigForCompany, setCompanyMobileRoles, setCompanyModules, updateCompany, updateMenuItem, updateVehicle } from '../../domain/admin.service.js';
import { sectorsFromBody, vehicleDto } from './helpers.js';

export function registerAdminRoutes(app: express.Express) {
  app.get('/api/admin/companies', platformAdminRequired, (_req, res, next) => {
    try {
      res.json({ companies: listCompanies() });
    } catch (e) {
      next(e);
    }
  });

  app.post('/api/admin/companies', platformAdminRequired, (req, res, next) => {
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

  app.patch('/api/admin/companies/:id', platformAdminRequired, (req, res, next) => {
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

  app.get('/api/admin/companies/:id/modules', platformAdminRequired, (req, res, next) => {
    try {
      res.json({
        moduleIds: companyModuleIds(req.params.id),
        modules: listAllModules(),
      });
    } catch (e) {
      next(e);
    }
  });

  app.put('/api/admin/companies/:id/modules', platformAdminRequired, (req, res, next) => {
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

  app.get('/api/admin/companies/:id/mobile-roles', platformAdminRequired, (req, res, next) => {
    try {
      res.json({
        roleIds: companyMobileRoleIds(req.params.id),
        roles: listMobileRoles(),
      });
    } catch (e) {
      next(e);
    }
  });

  app.put('/api/admin/companies/:id/mobile-roles', platformAdminRequired, (req, res, next) => {
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

  app.get('/api/admin/companies/:id/vehicles', platformAdminRequired, (req, res, next) => {
    try {
      res.json({ vehicles: listVehicles(req.params.id).map((v) => vehicleDto(v)) });
    } catch (e) {
      next(e);
    }
  });

  app.post('/api/admin/companies/:id/vehicles', platformAdminRequired, (req, res, next) => {
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

  app.patch('/api/admin/vehicles/:id', platformAdminRequired, (req, res, next) => {
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

  app.delete('/api/admin/vehicles/:id', platformAdminRequired, (req, res, next) => {
    try {
      res.json(deleteVehicle(req.params.id));
    } catch (e) {
      next(e);
    }
  });

  app.get('/api/admin/modules', platformAdminRequired, (_req, res, next) => {
    try {
      res.json({ modules: listModules() });
    } catch (e) {
      next(e);
    }
  });

  app.get('/api/admin/mobile-roles', platformAdminRequired, (_req, res, next) => {
    try {
      res.json({ roles: listMobileRoles() });
    } catch (e) {
      next(e);
    }
  });

  app.get('/api/admin/menu', platformAdminRequired, (_req, res, next) => {
    try {
      res.json({ items: listMenuItems() });
    } catch (e) {
      next(e);
    }
  });

  app.patch('/api/admin/menu/:id', platformAdminRequired, (req, res, next) => {
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
}
