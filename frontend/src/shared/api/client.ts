import type { AppState, Location, Meta, Metrics } from '../types';
import { clearSession, getToken, type AuthUser } from '../auth/session';

type StateResponse = { state: AppState; metrics: Metrics };

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
    request<Array<{ id: string; loc: string; batch: string; qty: number; productId: string }>>(
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
  prepare: (orderId: string) =>
    request<StateResponse>(`/api/orders/${encodeURIComponent(orderId)}/prepare`, {
      method: 'POST',
    }),
  dispatch: (orderIds: string[], vehicle?: string) =>
    request<StateResponse>('/api/dispatch', {
      method: 'POST',
      body: JSON.stringify({ orderIds, vehicle }),
    }),
  delivery: (body: { orderId: string; person: string; notes?: string }) =>
    request<StateResponse>('/api/delivery', { method: 'POST', body: JSON.stringify(body) }),
  incident: (body: { orderId: string; reason: string; notes?: string }) =>
    request<StateResponse>('/api/incidents', { method: 'POST', body: JSON.stringify(body) }),
  addClient: (body: Record<string, unknown>) =>
    request<StateResponse>('/api/clients', { method: 'POST', body: JSON.stringify(body) }),
  addPurchase: (body: Record<string, unknown>) =>
    request<StateResponse>('/api/purchases', { method: 'POST', body: JSON.stringify(body) }),
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
