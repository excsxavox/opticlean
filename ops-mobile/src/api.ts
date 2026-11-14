import { clearSession, getToken, type AuthUser } from './auth';
import type { AppState, PlacementResponse, Product, PickStep } from './types';

export type { AppState, PlacementOption, PlacementResponse, Product, WarehouseFamily } from './types';

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

export const api = {
  login: (email: string, password: string) =>
    request<{ token: string; user: AuthUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  me: () => request<{ user: AuthUser }>('/api/auth/me'),
  getState: () => request<{ state: AppState }>('/api/state'),
  placement: (productId: string, qty: number) =>
    request<PlacementResponse>(
      `/api/placement?productId=${encodeURIComponent(productId)}&qty=${qty}`,
    ),
  receive: (body: {
    productId: string;
    qty: number;
    loc: string;
    batch: string;
    expiry: string;
    supplier: string;
  }) => request<{ state: AppState }>('/api/receptions', { method: 'POST', body: JSON.stringify(body) }),
  pickPlan: (orderId: string) =>
    request<PickStep[]>(`/api/orders/${encodeURIComponent(orderId)}/pick-plan`),
  prepareOrder: (orderId: string) =>
    request<{ state: AppState }>(`/api/orders/${encodeURIComponent(orderId)}/prepare`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  move: (body: { productId: string; qty: number; from: string; to: string; batch?: string }) =>
    request<{ state: AppState }>('/api/moves', { method: 'POST', body: JSON.stringify(body) }),
  delivery: (body: { orderId: string; person: string; notes?: string }) =>
    request<{ state: AppState }>('/api/delivery', { method: 'POST', body: JSON.stringify(body) }),
  incident: (body: { orderId: string; reason: string; notes?: string }) =>
    request<{ state: AppState }>('/api/incidents', { method: 'POST', body: JSON.stringify(body) }),
  dispatch: (orderIds: string[], vehicle?: string) =>
    request<{ state: AppState }>('/api/dispatch', {
      method: 'POST',
      body: JSON.stringify({ orderIds, vehicle }),
    }),
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
};

export function findProduct(products: Product[], code: string) {
  const q = code.trim().toUpperCase();
  if (!q) return undefined;
  return products.find(
    (p) =>
      p.id.toUpperCase() === q ||
      p.sku.toUpperCase() === q ||
      p.name.toUpperCase() === q ||
      p.id.toUpperCase().includes(q) ||
      p.sku.toUpperCase().includes(q),
  );
}
