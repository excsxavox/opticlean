import type { AppState } from '../types';
import { available, product, reserved, stock } from './inventory';

function safe(v: unknown) {
  const t = String(v ?? '');
  return `"${(/^[=+@\-\t\r]/.test(t) ? "'" + t : t).replaceAll('"', '""')}"`;
}

export function downloadCSV(name: string, rows: unknown[][]) {
  const blob = new Blob(
    ['\uFEFF' + rows.map((r) => r.map(safe).join(';')).join('\r\n')],
    { type: 'text/csv;charset=utf-8' },
  );
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 500);
}

export function exportInventory(state: AppState) {
  downloadCSV('OPTICLEAN_Inventario.csv', [
    [
      'Código',
      'Producto',
      'Línea',
      'Proveedor',
      'Físico',
      'Reservado',
      'Disponible',
      'Mínimo',
      'PVP',
      'Valor PVP',
    ],
    ...state.products.map((p) => [
      p.id,
      p.name,
      p.category,
      p.supplier,
      stock(state, p.id),
      reserved(state, p.id),
      available(state, p.id),
      p.min,
      p.price,
      (stock(state, p.id) * p.price).toFixed(2),
    ]),
  ]);
}

export function exportLocations(state: AppState, locations: { id: string; rack: string; level: number; pos: number; capacity: number }[]) {
  downloadCSV('OPTICLEAN_Ubicaciones.csv', [
    ['Ubicación', 'Rack', 'Nivel', 'Posición', 'Capacidad total', 'Producto', 'Lote', 'Vencimiento', 'Cantidad'],
    ...locations.flatMap((l) => {
      const lots = state.lots.filter((t) => t.loc === l.id);
      return lots.length
        ? lots.map((t) => [
            l.id,
            l.rack,
            l.level,
            l.pos,
            l.capacity,
            product(state, t.productId)?.name ?? '',
            t.batch,
            t.expiry,
            t.qty,
          ])
        : [[l.id, l.rack, l.level, l.pos, l.capacity, 'Disponible', '', '', 0]];
    }),
  ]);
}

export function exportEvents(state: AppState) {
  downloadCSV('OPTICLEAN_Trazabilidad.csv', [
    ['Fecha', 'Tipo', 'Producto', 'Lote', 'Cantidad', 'Origen', 'Destino', 'Referencia', 'Responsable'],
    ...state.events.map((e) => [
      e.at,
      e.type,
      product(state, e.productId)?.name ?? e.productId,
      e.batch ?? '',
      e.qty,
      e.from,
      e.to,
      e.ref,
      e.by,
    ]),
  ]);
}
