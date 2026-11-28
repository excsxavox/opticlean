import express from 'express';
import { login, type AuthRole } from '../auth/auth.js';

export function roleDenied(req: express.Request) {
  const role = req.user?.role;
  const perms = req.user?.permissions ?? [];
  if (!role || role === 'admin') return null;
  const path = req.path;
  if (req.method === 'GET' || req.method === 'HEAD') {
    // Etiquetas y listas llevan datos del cliente: solo quien empaca o despacha.
    if (path.startsWith('/api/packing')) return role === 'ops' || role === 'dispatch' ? null : 'Tu rol no tiene permiso para esta consulta.';
    // Costos de flota: solo quien planifica rutas (los camiones sí los ven todos).
    if (path === '/api/fleet/manage' || /^\/api\/fleet\/[^/]+\/(cost-rules|km)$/.test(path)) {
      return role === 'dispatch' ? null : 'Tu rol no tiene permiso para esta consulta.';
    }
    return null;
  }
  const has = (...needed: string[]) => needed.some((p) => perms.includes(p) || perms.includes('*'));
  const allow = (roles: AuthRole[], permission?: string) => {
    if (roles.includes(role)) return null;
    if (permission && has(permission)) return null;
    return 'Tu rol no tiene permiso para esta acción.';
  };
  if (path === '/api/delivery' || path === '/api/incidents' || path === '/api/delivery/skip') {
    return allow(['dispatch', 'driver', 'ops'], 'field');
  }
  // Kilometraje: lo registra quien conduce o despacha. El resto de la flota es de despacho/administración.
  if (/^\/api\/fleet\/[^/]+\/(km|odometer)$/.test(path)) return allow(['dispatch', 'driver'], 'field');
  if (path.startsWith('/api/fleet')) return allow(['dispatch']);
  if (req.method === 'DELETE' && (path.startsWith('/api/clients/') || path.startsWith('/api/products/'))) {
    return allow([]);
  }
  if (path.startsWith('/api/packing') || path.startsWith('/api/loading')) {
    return allow(['ops', 'dispatch'], 'packing');
  }
  if (path === '/api/dispatch' || path.startsWith('/api/logistics')) {
    return allow(['dispatch'], 'dispatch');
  }
  if (path.startsWith('/api/guides')) return allow(['dispatch', 'ops'], 'orders');
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
  if (
    req.method === 'POST' &&
    ((path === '/api/receptions' && !req.body?.purchaseId) || path === '/api/receptions/batch')
  ) {
    return 'Recibir sin orden de compra requiere aprobación de administración.';
  }
  if (req.method === 'PATCH' && /^\/api\/clients\/[^/]+$/.test(path)) {
    const body = req.body ?? {};
    if (body.creditLimit != null || body.paymentTermsDays != null) {
      return 'Solo administración cambia el cupo o el plazo de crédito.';
    }
  }
  // Bodega (ops) o quien tenga permisos operativos de inventario/pedidos.
  if (role === 'ops' || has('warehouse', 'inventory', 'reception', 'orders', 'purchases')) return null;
  return 'Tu rol no tiene permiso para esta acción.';
}

export const PUBLIC_API_PATHS = new Set([
  '/api/health',
  '/api/auth/login',
  '/api/auth/signup',
  '/api/auth/password/forgot',
  '/api/auth/password/reset',
  '/api/auth/refresh',
  '/api/auth/logout',
  '/api/public/config',
  '/api/public/delivery-code',
]);
