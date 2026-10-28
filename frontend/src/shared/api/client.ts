import type { AppState, Location, Meta, Metrics } from '../types';

type StateResponse = { state: AppState; metrics: Metrics };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
  return data as T;
}

export const api = {
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
};
