import { assertRuc } from './ruc.js';
import type { AppState, Supplier } from './types.js';

export function ensureSuppliers(s: AppState) {
  if (!s.suppliers) s.suppliers = [];
  return s.suppliers;
}

function clean(body: Partial<Supplier>, current?: Supplier): Supplier {
  const name = (body.name ?? current?.name ?? '').trim();
  if (!name) throw new Error('Escribe el nombre del proveedor.');
  const lead = Number(body.leadTimeDays ?? current?.leadTimeDays ?? 7);
  if (!Number.isInteger(lead) || lead < 0) throw new Error('El tiempo de entrega debe ser un entero de días.');
  const email = (body.email ?? current?.email ?? '').trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('El correo del proveedor no es válido.');
  const taxId = String(body.taxId ?? current?.taxId ?? '').replace(/\D/g, '');
  assertRuc(taxId, 'RUC del proveedor', current?.taxId);
  return {
    id: current?.id ?? '',
    name,
    taxId,
    contact: (body.contact ?? current?.contact ?? '').trim(),
    email,
    phone: (body.phone ?? current?.phone ?? '').trim(),
    leadTimeDays: lead,
    terms: (body.terms ?? current?.terms ?? '').trim(),
    notes: (body.notes ?? current?.notes ?? '').trim() || undefined,
  };
}

export function createSupplier(s: AppState, body: Partial<Supplier>) {
  const suppliers = ensureSuppliers(s);
  const data = clean(body);
  if (suppliers.some((supplier) => supplier.name.toLowerCase() === data.name.toLowerCase())) {
    throw new Error('Ya existe un proveedor con ese nombre.');
  }
  if (suppliers.some((supplier) => supplier.taxId === data.taxId)) {
    throw new Error('Ya existe un proveedor con ese RUC.');
  }
  const n = suppliers.reduce((max, supplier) => Math.max(max, Number(supplier.id.replace(/\D/g, '')) || 0), 0) + 1;
  const created: Supplier = { ...data, id: `PR-${String(n).padStart(3, '0')}` };
  suppliers.push(created);
  return created;
}

export function updateSupplier(s: AppState, id: string, body: Partial<Supplier>) {
  const suppliers = ensureSuppliers(s);
  const current = suppliers.find((supplier) => supplier.id === id);
  if (!current) throw new Error('Proveedor no encontrado.');
  const data = clean({ ...current, ...body }, current);
  if (suppliers.some((supplier) => supplier.id !== id && supplier.name.toLowerCase() === data.name.toLowerCase())) {
    throw new Error('Ya existe un proveedor con ese nombre.');
  }
  if (suppliers.some((supplier) => supplier.id !== id && supplier.taxId === data.taxId)) {
    throw new Error('Ya existe un proveedor con ese RUC.');
  }
  Object.assign(current, data, { id });
  return current;
}

export function findSupplier(s: AppState, name: string, taxId = '') {
  const suppliers = ensureSuppliers(s);
  const tax = taxId.replace(/\D/g, '');
  return (
    suppliers.find((supplier) => tax && supplier.taxId.replace(/\D/g, '') === tax) ??
    suppliers.find((supplier) => supplier.name.toLowerCase() === name.trim().toLowerCase())
  );
}
