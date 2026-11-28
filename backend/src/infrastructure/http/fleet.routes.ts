import express from 'express';
import { authRequired } from '../auth/auth.js';
import { applyDefaultCostRules, createVehicle, createVehicleCostRule, deleteVehicle, deleteVehicleCostRule, duplicateVehicleCostRules, fleetForCompany, getVehicleCostPanel, listVehicleKmLogs, listVehicles, menuForCompany, mobileConfigForCompany, applyShippingTemplateToFleet, recordVehicleKm, setVehicleOdometer, updateVehicle, updateVehicleCostRule } from '../../domain/admin.service.js';
import { companyIdOf, assertVehicleOfCompany, sectorsFromBody, vehicleDto } from './helpers.js';

export function registerFleetRoutes(app: express.Express) {
  /** Menú dinámico según módulos de la empresa del usuario */
  app.get('/api/menu', authRequired, (req, res, next) => {
    try {
      const companyId = req.user?.platformAdmin && req.query.companyId ? String(req.query.companyId) : companyIdOf(req);
      res.json(menuForCompany(companyId));
    } catch (e) {
      next(e);
    }
  });

  /** Flota activa de la empresa (web + ops-mobile) */
  app.get('/api/fleet', authRequired, (req, res, next) => {
    try {
      // Solo la plataforma consulta la flota de otra empresa.
      const companyId = req.user?.platformAdmin && req.query.companyId ? String(req.query.companyId) : companyIdOf(req);
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
        shippingTemplateId:
          req.body?.shippingTemplateId !== undefined
            ? req.body.shippingTemplateId
              ? String(req.body.shippingTemplateId)
              : ''
            : undefined,
      });
      res.status(201).json({
        vehicle: vehicleDto(vehicle),
        trucks: fleetForCompany(companyIdOf(req)),
      });
    } catch (e) {
      next(e);
    }
  });

  app.post('/api/fleet/shipping-template', authRequired, (req, res, next) => {
    try {
      const templateId = String(req.body?.templateId ?? '').trim();
      const vehicleIds = Array.isArray(req.body?.vehicleIds)
        ? req.body.vehicleIds.map(String)
        : undefined;
      const result = applyShippingTemplateToFleet(companyIdOf(req), templateId, vehicleIds);
      res.json(result);
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
        shippingTemplateId:
          req.body?.shippingTemplateId !== undefined
            ? req.body.shippingTemplateId
              ? String(req.body.shippingTemplateId)
              : ''
            : undefined,
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

  /** Reglas de costo real (combustible, llantas, peaje, etc.) */
  app.get('/api/fleet/:id/cost-rules', authRequired, (req, res, next) => {
    try {
      res.json(getVehicleCostPanel(companyIdOf(req), req.params.id));
    } catch (e) {
      next(e);
    }
  });

  app.post('/api/fleet/:id/cost-rules', authRequired, (req, res, next) => {
    try {
      const companyId = companyIdOf(req);
      const rule = createVehicleCostRule(companyId, req.params.id, {
        name: String(req.body?.name ?? ''),
        category: req.body?.category ? String(req.body.category) : undefined,
        basis: req.body?.basis === 'per_trip' ? 'per_trip' : 'per_km',
        calc: req.body?.calc === 'amortized' ? 'amortized' : 'fixed',
        amount: Number(req.body?.amount),
        lifeUnits: req.body?.lifeUnits !== undefined ? Number(req.body.lifeUnits) : undefined,
        active: req.body?.active !== false,
      });
      res.status(201).json({
        rule,
        ...getVehicleCostPanel(companyId, req.params.id),
        trucks: fleetForCompany(companyId),
      });
    } catch (e) {
      next(e);
    }
  });

  app.patch('/api/fleet/cost-rules/:ruleId', authRequired, (req, res, next) => {
    try {
      const companyId = companyIdOf(req);
      const rule = updateVehicleCostRule(companyId, req.params.ruleId, {
        name: req.body?.name !== undefined ? String(req.body.name) : undefined,
        category: req.body?.category !== undefined ? String(req.body.category) : undefined,
        basis: req.body?.basis !== undefined ? (req.body.basis === 'per_trip' ? 'per_trip' : 'per_km') : undefined,
        calc: req.body?.calc !== undefined ? (req.body.calc === 'amortized' ? 'amortized' : 'fixed') : undefined,
        amount: req.body?.amount !== undefined ? Number(req.body.amount) : undefined,
        lifeUnits: req.body?.lifeUnits !== undefined ? Number(req.body.lifeUnits) : undefined,
        active: typeof req.body?.active === 'boolean' ? req.body.active : undefined,
      });
      const vehicleId = String(rule.vehicleId || '');
      res.json({
        rule,
        ...(vehicleId ? getVehicleCostPanel(companyId, vehicleId) : {}),
        trucks: fleetForCompany(companyId),
      });
    } catch (e) {
      next(e);
    }
  });

  app.delete('/api/fleet/cost-rules/:ruleId', authRequired, (req, res, next) => {
    try {
      const companyId = companyIdOf(req);
      deleteVehicleCostRule(companyId, req.params.ruleId);
      res.json({ ok: true, trucks: fleetForCompany(companyId) });
    } catch (e) {
      next(e);
    }
  });

  app.post('/api/fleet/:id/cost-rules/duplicate', authRequired, (req, res, next) => {
    try {
      const targets = Array.isArray(req.body?.targetVehicleIds)
        ? req.body.targetVehicleIds.map((x: unknown) => String(x))
        : [];
      res.json(duplicateVehicleCostRules(companyIdOf(req), req.params.id, targets));
    } catch (e) {
      next(e);
    }
  });

  app.post('/api/fleet/:id/cost-rules/defaults', authRequired, (req, res, next) => {
    try {
      const companyId = companyIdOf(req);
      const result = applyDefaultCostRules(companyId, req.params.id, Boolean(req.body?.replace));
      res.json({ ...result, trucks: fleetForCompany(companyId) });
    } catch (e) {
      next(e);
    }
  });

  /** Historial y registro de kilómetros del vehículo */
  app.get('/api/fleet/:id/km', authRequired, (req, res, next) => {
    try {
      const companyId = companyIdOf(req);
      const vehicle = assertVehicleOfCompany(req.params.id, companyId);
      res.json({
        vehicleId: vehicle.id,
        plate: vehicle.plate,
        odometerKm: Number(vehicle.odometer_km) || 0,
        logs: listVehicleKmLogs(companyId, vehicle.id, Number(req.query.limit) || 50),
      });
    } catch (e) {
      next(e);
    }
  });

  app.post('/api/fleet/:id/km', authRequired, (req, res, next) => {
    try {
      const companyId = companyIdOf(req);
      assertVehicleOfCompany(req.params.id, companyId);
      const result = recordVehicleKm(companyId, {
        vehicleId: req.params.id,
        km: Number(req.body?.km),
        stops: req.body?.stops !== undefined ? Number(req.body.stops) : undefined,
        source: 'manual',
        note: req.body?.note ? String(req.body.note) : 'Registro manual de km',
      });
      res.status(201).json(result);
    } catch (e) {
      next(e);
    }
  });

  app.post('/api/fleet/:id/odometer', authRequired, (req, res, next) => {
    try {
      const companyId = companyIdOf(req);
      assertVehicleOfCompany(req.params.id, companyId);
      res.json(
        setVehicleOdometer(
          companyId,
          req.params.id,
          Number(req.body?.odometerKm),
          req.body?.note ? String(req.body.note) : '',
        ),
      );
    } catch (e) {
      next(e);
    }
  });

  /** Roles móviles habilitados para la empresa */
  app.get('/api/mobile/config', authRequired, (req, res, next) => {
    try {
      // Solo la plataforma puede consultar la configuración de otra empresa.
      const requested = req.user?.platformAdmin && req.query.companyId ? String(req.query.companyId) : '';
      res.json(mobileConfigForCompany(requested || companyIdOf(req)));
    } catch (e) {
      next(e);
    }
  });
}
