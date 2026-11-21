import type { AppState, Location, Meta, Metrics, PlanAction } from '../types';
import { clearSession, getToken, type AuthUser } from '../auth/session';

type StateResponse = { state: AppState; metrics: Metrics };

export type ManagedUser = {
  id: string;
  email: string;
  name: string;
  role: AuthUser['role'];
  companyId: string;
  truckPlate?: string;
  active: boolean;
  isDemo: boolean;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(path, {
    ...init,
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/auth/login') {
    clearSession();
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.assign('/login');
    }
  }
  if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
  return data as T;
}

export async function downloadReport(kind: 'traceability' | 'diagnostics', format: 'xlsx' | 'pdf') {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`/api/reports/${kind}?format=${format}`, { headers });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? 'No se pudo descargar el informe.');
  }
  const blob = await res.blob();
  const match = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = match?.[1] ?? `OPTICLEAN_${kind}.${format}`;
  link.click();
  URL.revokeObjectURL(url);
}

export const api = {
  login: (email: string, password: string) =>
    request<{ token: string; user: AuthUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  me: () => request<{ user: AuthUser }>('/api/auth/me'),
  getMeta: () => request<Meta>('/api/meta'),
  getState: () => request<StateResponse>('/api/state'),
  reset: () => request<StateResponse>('/api/state/reset', { method: 'POST' }),
  updateSettings: (body: Partial<AppState['settings']>) =>
    request<StateResponse>('/api/settings', { method: 'PATCH', body: JSON.stringify(body) }),
  suggest: (productId: string, qty: number, exclude = '') =>
    request<Location[]>(
      `/api/suggest?productId=${encodeURIComponent(productId)}&qty=${qty}&exclude=${encodeURIComponent(exclude)}`,
    ),
  pickPlan: (orderId: string) =>
    request<Array<{ id: string; loc: string; batch: string; qty: number; productId: string; expiry: string; purchaseId?: string }>>(
      `/api/orders/${encodeURIComponent(orderId)}/pick-plan`,
    ),
  receive: (body: Record<string, unknown>) =>
    request<StateResponse>('/api/receptions', { method: 'POST', body: JSON.stringify(body) }),
  move: (body: Record<string, unknown>) =>
    request<StateResponse>('/api/moves', { method: 'POST', body: JSON.stringify(body) }),
  saveProduct: (body: Record<string, unknown>) =>
    request<StateResponse>('/api/products', { method: 'POST', body: JSON.stringify(body) }),
  createOrder: (body: Record<string, unknown>) =>
    request<StateResponse>('/api/orders', { method: 'POST', body: JSON.stringify(body) }),
  importOrderXml: (xml: string) =>
    request<
      StateResponse & {
        import: {
          orderId: string;
          clientId: string;
          clientCreated: boolean;
          productsCreated: string[];
          productsUpdated: string[];
          source: 'openai' | 'heuristic';
          openai: boolean;
          invoice: {
            buyerName: string;
            buyerId: string;
            docNumber: string;
            issueDate: string;
            source?: 'openai' | 'heuristic';
            lines: Array<{ code: string; name: string; qty: number; unitPrice: number }>;
          };
        };
      }
    >('/api/orders/from-xml', { method: 'POST', body: JSON.stringify({ xml }) }),
  importOrderFile: (body: { fileName: string; mimeType?: string; contentBase64: string }) =>
    request<
      StateResponse & {
        import: {
          orderId: string;
          clientId: string;
          clientCreated: boolean;
          productsCreated: string[];
          productsUpdated: string[];
          source: 'openai' | 'heuristic';
          openai: boolean;
          invoice: {
            buyerName: string;
            buyerId: string;
            docNumber: string;
            issueDate: string;
            source?: 'openai' | 'heuristic';
            lines: Array<{ code: string; name: string; qty: number; unitPrice: number }>;
          };
        };
      }
    >('/api/orders/from-file', { method: 'POST', body: JSON.stringify(body) }),
  saveVehicle: (body: Record<string, unknown>) =>
    request<StateResponse>('/api/vehicles', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deleteVehicle: (id: string) =>
    request<StateResponse>(`/api/vehicles/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  prepare: (orderId: string) =>
    request<StateResponse>(`/api/orders/${encodeURIComponent(orderId)}/prepare`, {
      method: 'POST',
    }),
  assignOrder: (orderId: string, userId: string) =>
    request<StateResponse>(`/api/orders/${encodeURIComponent(orderId)}/assign`, {
      method: 'POST',
      body: JSON.stringify({ userId }),
    }),
  unassignOrder: (orderId: string) =>
    request<StateResponse>(`/api/orders/${encodeURIComponent(orderId)}/unassign`, {
      method: 'POST',
    }),
  listUsers: (opts?: { role?: string; activeOnly?: boolean }) => {
    const q = new URLSearchParams();
    if (opts?.role) q.set('role', opts.role);
    if (opts?.activeOnly) q.set('activeOnly', '1');
    const qs = q.toString();
    return request<{ users: ManagedUser[] }>(`/api/users${qs ? `?${qs}` : ''}`);
  },
  createUser: (body: {
    name: string;
    email: string;
    password: string;
    role: string;
    truckPlate?: string;
  }) =>
    request<{ user: ManagedUser }>('/api/users', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateUser: (
    id: string,
    body: {
      name?: string;
      email?: string;
      password?: string;
      role?: string;
      truckPlate?: string | null;
      active?: boolean;
    },
  ) =>
    request<{ user: ManagedUser }>(`/api/users/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deactivateUser: (id: string) =>
    request<{ user: ManagedUser }>(`/api/users/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  dispatch: (orderIds: string[], vehicle?: string) =>
    request<StateResponse>('/api/dispatch', {
      method: 'POST',
      body: JSON.stringify({ orderIds, vehicle }),
    }),
  delivery: (body: { orderId: string; person: string; notes?: string; code?: string }) =>
    request<StateResponse>('/api/delivery', { method: 'POST', body: JSON.stringify(body) }),
  skipStop: (orderId: string) =>
    request<StateResponse>('/api/delivery/skip', { method: 'POST', body: JSON.stringify({ orderId }) }),
  incident: (body: { orderId: string; reason: string; notes?: string }) =>
    request<StateResponse>('/api/incidents', { method: 'POST', body: JSON.stringify(body) }),
  addClient: (body: Record<string, unknown>) =>
    request<StateResponse>('/api/clients', { method: 'POST', body: JSON.stringify(body) }),
  updateClient: (id: string, body: Record<string, unknown>) =>
    request<StateResponse>(`/api/clients/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  addPurchase: (body: Record<string, unknown>) =>
    request<StateResponse>('/api/purchases', { method: 'POST', body: JSON.stringify(body) }),
  cancelPurchase: (id: string) =>
    request<StateResponse>(`/api/purchases/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  receivePurchase: (
    id: string,
    lines: Array<{ productId: string; qty: number; loc: string; batch: string; expiry: string; inspect?: boolean }>,
  ) =>
    request<StateResponse>(`/api/purchases/${encodeURIComponent(id)}/receive`, {
      method: 'POST',
      body: JSON.stringify({ lines }),
    }),
  closePurchase: (id: string, reason: string) =>
    request<StateResponse>(`/api/purchases/${encodeURIComponent(id)}/close`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  releaseLot: (lotId: string) =>
    request<StateResponse>(`/api/lots/${encodeURIComponent(lotId)}/release`, { method: 'POST' }),
  rejectLot: (lotId: string, reason: string) =>
    request<StateResponse>(`/api/lots/${encodeURIComponent(lotId)}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  config: () => request<{ production: boolean; resetAllowed: boolean }>('/api/config'),
  cancelOrder: (orderId: string, reason: string) =>
    request<StateResponse>(`/api/orders/${encodeURIComponent(orderId)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  addSupplier: (body: Record<string, unknown>) =>
    request<StateResponse>('/api/suppliers', { method: 'POST', body: JSON.stringify(body) }),
  updateSupplier: (id: string, body: Record<string, unknown>) =>
    request<StateResponse>(`/api/suppliers/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  saveBundle: (body: Record<string, unknown>) =>
    request<StateResponse>('/api/bundles', { method: 'POST', body: JSON.stringify(body) }),
  assembleBundle: (id: string, body: Record<string, unknown>) =>
    request<StateResponse>(`/api/bundles/${encodeURIComponent(id)}/assemble`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  previewImport: (body: { kind: 'purchase' | 'sale'; format: string; text?: string; base64?: string }) =>
    request<{
      kind: 'purchase' | 'sale';
      source: string;
      partyName: string;
      partyTaxId: string;
      partyAddress: string;
      docNumber: string;
      issueDate: string;
      warnings: string[];
      rows: Array<{
        code: string;
        name: string;
        qty: number;
        packCode: string;
        unitPrice: number;
        batch: string;
        expiry: string;
        productId: string | null;
        status: 'matched' | 'new' | 'invalid';
        message: string;
      }>;
    }>('/api/imports/preview', { method: 'POST', body: JSON.stringify(body) }),
  commitImport: (body: Record<string, unknown>) =>
    request<StateResponse & { import: { kind: string; purchaseId: string; orderId: string } }>(
      '/api/imports/commit',
      { method: 'POST', body: JSON.stringify(body) },
    ),
  assistant: (query: 'stock' | 'warehouse' | 'orders') =>
    request<{ lines: string[] }>(`/api/assistant/${query}`),
  addWarehouse: (body: Record<string, unknown>) =>
    request<StateResponse>('/api/warehouses', { method: 'POST', body: JSON.stringify(body) }),
  updateWarehouse: (id: string, body: Record<string, unknown>) =>
    request<StateResponse>(`/api/warehouses/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteWarehouse: (id: string) =>
    request<StateResponse>(`/api/warehouses/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  activateWarehouse: (id: string) =>
    request<StateResponse>(`/api/warehouses/${encodeURIComponent(id)}/activate`, { method: 'POST' }),
  saveFamily: (body: Record<string, unknown>) =>
    request<StateResponse>('/api/families', { method: 'POST', body: JSON.stringify(body) }),
  deleteFamily: (id: string) =>
    request<StateResponse>(`/api/families/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  placement: (productId: string, qty: number, exclude = '') =>
    request<{
      productId: string;
      qty: number;
      best: (Location & { score: number; free: number; reasons: string[]; familyMatch: boolean; fragileSafe: boolean; isEmpty: boolean; consolidates: boolean }) | null;
      options: Array<Location & { score: number; free: number; reasons: string[]; familyMatch: boolean; fragileSafe: boolean; isEmpty: boolean; consolidates: boolean }>;
      guidance: string;
      product: { id: string; name: string; category: string; fragile: boolean; familyId?: string } | null;
    }>(
      `/api/placement?productId=${encodeURIComponent(productId)}&qty=${qty}&exclude=${encodeURIComponent(exclude)}`,
    ),
  menu: (companyId?: string) =>
    request<{
      company: { id: string; name: string; slug: string } | null;
      sections: Array<{
        section: string;
        items: Array<{
          id: string;
          label: string;
          path: string;
          icon: string;
          section: string;
          badge: string | null;
        }>;
      }>;
    }>(`/api/menu${companyId ? `?companyId=${encodeURIComponent(companyId)}` : ''}`),
  fleet: (companyId?: string) =>
    request<{
      trucks: Array<{
        id: string;
        plate: string;
        label: string;
        vehicleType?: 'carro' | 'camion' | 'motocicleta';
        vehicleTypeLabel?: string;
        city: string;
        driver: string;
        maxKg: number;
        maxM3: number;
        costPerKm: number;
        etaHours: number;
        routeKm: number;
        allowedSectors?: string[];
        baseOccupancy: number;
      }>;
    }>(`/api/fleet${companyId ? `?companyId=${encodeURIComponent(companyId)}` : ''}`),
  fleetManage: () =>
    request<{
      vehicles: Array<{
        id: string;
        company_id: string;
        plate: string;
        label: string;
        vehicle_type: 'carro' | 'camion' | 'motocicleta';
        city: string;
        driver: string;
        max_kg: number;
        max_m3: number;
        cost_per_km: number;
        eta_hours: number;
        route_km: number;
        allowed_sectors?: string;
        allowed_sectors_list?: string[];
        active: number;
        sort_order: number;
      }>;
    }>('/api/fleet/manage'),
  createFleetVehicle: (body: {
    plate: string;
    label: string;
    vehicleType?: 'carro' | 'camion' | 'motocicleta';
    city?: string;
    driver?: string;
    maxKg?: number;
    maxM3?: number;
    costPerKm?: number;
    etaHours?: number;
    routeKm?: number;
    allowedSectors?: string[];
  }) =>
    request<{
      vehicle: Record<string, unknown>;
      trucks: Array<{
        id: string;
        plate: string;
        label: string;
        vehicleType?: 'carro' | 'camion' | 'motocicleta';
        vehicleTypeLabel?: string;
        city: string;
        driver: string;
        maxKg: number;
        maxM3: number;
        costPerKm: number;
        etaHours: number;
        routeKm: number;
        allowedSectors?: string[];
        baseOccupancy: number;
      }>;
    }>('/api/fleet', { method: 'POST', body: JSON.stringify(body) }),
  updateFleetVehicle: (
    id: string,
    body: Partial<{
      plate: string;
      label: string;
      vehicleType: 'carro' | 'camion' | 'motocicleta';
      city: string;
      driver: string;
      maxKg: number;
      maxM3: number;
      costPerKm: number;
      etaHours: number;
      routeKm: number;
      allowedSectors: string[];
      active: boolean;
    }>,
  ) =>
    request<{
      vehicle: Record<string, unknown>;
      trucks: Array<{
        id: string;
        plate: string;
        label: string;
        vehicleType?: 'carro' | 'camion' | 'motocicleta';
        vehicleTypeLabel?: string;
        city: string;
        driver: string;
        maxKg: number;
        maxM3: number;
        costPerKm: number;
        etaHours: number;
        routeKm: number;
        allowedSectors?: string[];
        baseOccupancy: number;
      }>;
    }>(`/api/fleet/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteFleetVehicle: (id: string) =>
    request<{
      ok: boolean;
      trucks: Array<{
        id: string;
        plate: string;
        label: string;
        vehicleType?: 'carro' | 'camion' | 'motocicleta';
        vehicleTypeLabel?: string;
        city: string;
        driver: string;
        maxKg: number;
        maxM3: number;
        costPerKm: number;
        etaHours: number;
        routeKm: number;
        allowedSectors?: string[];
        baseOccupancy: number;
      }>;
    }>(`/api/fleet/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  logisticsAutoAssign: (body: {
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
  }) =>
    request<{
      openai: boolean;
      plan: {
        assignments: Array<{
          orderId: string;
          truckId: string;
          plate: string;
          truckLabel: string;
          city: string;
          kg: number;
          m3: number;
          reason: string;
        }>;
        byTruck: Record<string, string[]>;
        unassigned: Array<{ orderId: string; kg: number; m3: number; city: string; reason: string }>;
        summary: string;
        source: 'openai' | 'heuristic';
      };
    }>('/api/logistics/auto-assign', { method: 'POST', body: JSON.stringify(body) }),
  issueInvoice: (orderId: string) =>
    request<StateResponse>('/api/invoices', { method: 'POST', body: JSON.stringify({ orderId }) }),
  issueCreditNote: (body: { invoiceId: string; reason: string; lines: Array<{ productId: string; qty: number; batch?: string; restock?: boolean }> }) =>
    request<StateResponse>('/api/credit-notes', { method: 'POST', body: JSON.stringify(body) }),
  issueGuide: (body: { orderId?: string; transferId?: string }) =>
    request<StateResponse>('/api/guides', { method: 'POST', body: JSON.stringify(body) }),
  collectPayment: (body: Record<string, unknown>) =>
    request<StateResponse>('/api/payments', { method: 'POST', body: JSON.stringify(body) }),
  billSupplier: (body: Record<string, unknown>) =>
    request<StateResponse>('/api/supplier-bills', { method: 'POST', body: JSON.stringify(body) }),
  paySupplier: (body: Record<string, unknown>) =>
    request<StateResponse>('/api/supplier-payments', { method: 'POST', body: JSON.stringify(body) }),
  savePriceList: (body: Record<string, unknown>) =>
    request<StateResponse>('/api/price-lists', { method: 'POST', body: JSON.stringify(body) }),
  saveClientPrice: (body: Record<string, unknown>) =>
    request<StateResponse>('/api/client-prices', { method: 'POST', body: JSON.stringify(body) }),
  requestAdjustment: (body: Record<string, unknown>) =>
    request<StateResponse>('/api/adjustments', { method: 'POST', body: JSON.stringify(body) }),
  approveAdjustment: (id: string) =>
    request<StateResponse>(`/api/adjustments/${encodeURIComponent(id)}/approve`, { method: 'POST' }),
  returnToSupplier: (body: Record<string, unknown>) =>
    request<StateResponse>('/api/supplier-returns', { method: 'POST', body: JSON.stringify(body) }),
  startCycleCount: () => request<StateResponse>('/api/cycle-counts', { method: 'POST' }),
  applyCycleCount: (id: string, lines: Array<{ lotId: string; countedQty: number }>) =>
    request<StateResponse>(`/api/cycle-counts/${encodeURIComponent(id)}/apply`, {
      method: 'POST',
      body: JSON.stringify({ lines }),
    }),
  shipTransfer: (body: { toWarehouseId: string; lines: Array<{ lotId: string; qty: number }> }) =>
    request<StateResponse>('/api/transfers', { method: 'POST', body: JSON.stringify(body) }),
  receiveTransfer: (id: string, lines: Array<{ lotId: string; loc: string }>) =>
    request<StateResponse>(`/api/transfers/${encodeURIComponent(id)}/receive`, {
      method: 'POST',
      body: JSON.stringify({ lines }),
    }),
  replenishment: () =>
    request<{
      groups: Array<{
        supplierId: string;
        supplierName: string;
        leadTimeDays: number;
        lines: Array<{ productId: string; name: string; gap: number; packCode: string; packQty: number; unitsPerPack: number; unitPrice: number; reason: string }>;
      }>;
    }>('/api/replenishment'),
  createReplenishment: () => request<StateResponse>('/api/replenishment', { method: 'POST' }),
  recall: (batch: string) =>
    request<{
      batch: string;
      clients: Array<{ orderId: string; clientId: string; clientName: string; productId: string; qty: number; date: string; status: string }>;
      stock: Array<{ lotId: string; productId: string; qty: number; loc: string; warehouseId: string; expiry: string }>;
    }>(`/api/recall?batch=${encodeURIComponent(batch)}`),
  plan: () =>
    request<{
      actions: PlanAction[];
      forecast: Array<{
        clientId: string;
        name: string;
        weeklyUnits: number;
        orders: number;
        confidence: number;
        deviationPct: number;
        reorderEveryDays: number | null;
      }>;
      diagnostics: Array<{ orderId: string; clientId: string; hours: number; late: boolean; incident: string }>;
    }>('/api/plan'),
  approvePlan: (id: string) =>
    request<StateResponse>(`/api/plan/${encodeURIComponent(id)}/approve`, { method: 'POST' }),
  discardPlan: (id: string, note: string) =>
    request<StateResponse>(`/api/plan/${encodeURIComponent(id)}/discard`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    }),
  undoPlan: (id: string) => request<StateResponse>(`/api/plan/${encodeURIComponent(id)}/undo`, { method: 'POST' }),
  addQuote: (body: Record<string, unknown>) =>
    request<StateResponse>('/api/quotes', { method: 'POST', body: JSON.stringify(body) }),
  winQuote: (id: string) => request<StateResponse>(`/api/quotes/${encodeURIComponent(id)}/win`, { method: 'POST' }),
  loseQuote: (id: string) => request<StateResponse>(`/api/quotes/${encodeURIComponent(id)}/lose`, { method: 'POST' }),
  packOrder: (body: { orderId: string; weightKg: number; volumeM3: number }) =>
    request<StateResponse>('/api/packing', { method: 'POST', body: JSON.stringify(body) }),
  previewLoad: (plate: string, orderIds: string[]) =>
    request<{
      plate: string;
      kg: number;
      m3: number;
      fill: number;
      underMin: boolean;
      over: boolean;
      loadSequence: string[];
      trip: { km: number; allIn: number; fuel: number; fuelUnits: number; fuelType: string | null };
    }>('/api/loading/preview', { method: 'POST', body: JSON.stringify({ plate, orderIds }) }),
  addOffering: (body: Record<string, unknown>) =>
    request<StateResponse>('/api/offerings', { method: 'POST', body: JSON.stringify(body) }),
  deleteOffering: (id: string) =>
    request<StateResponse>(`/api/offerings/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  readLabel: (text: string) =>
    request<{
      name: string;
      presentations: string[];
      hazardous: boolean;
      warnings: string[];
      attributes: Array<{ name: string; value: string }>;
    }>('/api/products/read-label', { method: 'POST', body: JSON.stringify({ text }) }),
};
