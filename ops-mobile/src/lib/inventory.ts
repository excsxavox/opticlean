import type { AppState, Product } from '../types';

export function stock(state: AppState, productId: string) {
  return state.lots.reduce((n, lot) => (lot.productId === productId ? n + lot.qty : n), 0);
}

export function available(state: AppState, productId: string) {
  const reserved = state.orders
    .filter((o) => o.status === 'Por preparar' || o.status === 'Preparando')
    .reduce(
      (n, o) => n + o.lines.reduce((m, l) => (l.productId === productId ? m + l.qty : m), 0),
      0,
    );
  return stock(state, productId) - reserved;
}

export function qtyAt(state: AppState, loc: string) {
  return state.lots.reduce((n, lot) => (lot.loc === loc ? n + lot.qty : n), 0);
}

export function clientName(state: AppState, clientId: string) {
  return state.clients.find((c) => c.id === clientId)?.name ?? clientId;
}

export function productOf(state: AppState, id: string): Product | undefined {
  return state.products.find((p) => p.id === id);
}

export function money(n: number) {
  return new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

export function statusTone(status: string) {
  if (status === 'Entregado') return 'green';
  if (status === 'Preparado' || status === 'En ruta') return 'blue';
  if (status === 'Por preparar') return 'amber';
  return 'muted';
}
