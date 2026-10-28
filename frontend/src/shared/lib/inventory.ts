import type { AppState, Order, OrderLine } from '../types';

export const activeWarehouseId = (s: AppState) =>
  s.settings.activeWarehouseId ?? s.warehouses?.[0]?.id ?? 'WH-QT-01';

export const scopedLots = (s: AppState) =>
  s.lots.filter((l) => (l.warehouseId ?? 'WH-QT-01') === activeWarehouseId(s));

export const stock = (s: AppState, id: string) =>
  scopedLots(s)
    .filter((l) => l.productId === id)
    .reduce((n, l) => n + l.qty, 0);

export const reserved = (s: AppState, id: string) =>
  s.orders
    .filter((o) => o.status === 'Por preparar')
    .reduce(
      (n, o) => n + o.lines.filter((l) => l.productId === id).reduce((a, l) => a + l.qty, 0),
      0,
    );

export const available = (s: AppState, id: string) => stock(s, id) - reserved(s, id);

export const qtyAt = (s: AppState, loc: string) =>
  scopedLots(s)
    .filter((l) => l.loc === loc)
    .reduce((n, l) => n + l.qty, 0);

export const product = (s: AppState, id: string) => s.products.find((p) => p.id === id);

export const client = (s: AppState, id: string) => s.clients.find((c) => c.id === id);

export const orderValue = (s: AppState, o: { lines: OrderLine[] }) =>
  o.lines.reduce((n, l) => n + l.qty * (product(s, l.productId)?.price ?? 0), 0);

export const orderWeight = (s: AppState, o: Order) =>
  o.lines.reduce((n, l) => n + l.qty * (product(s, l.productId)?.weight ?? 0), 0);

export const money = (n: number) =>
  new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' }).format(n);

export const num = (n: number) => new Intl.NumberFormat('es-EC').format(n);

export const dateShort = (d: string) =>
  new Date(d.length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('es-EC', {
    day: '2-digit',
    month: 'short',
    timeZone: 'America/Guayaquil',
  });

export const time = (d: string) =>
  new Date(d).toLocaleTimeString('es-EC', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Guayaquil',
  });

export const statusColor = (s: string) =>
  ({
    'Por preparar': 'amber',
    Preparado: 'blue',
    'En ruta': 'purple',
    Entregado: 'green',
    Incidencia: 'red',
    Solicitada: 'blue',
  })[s] ?? '';
