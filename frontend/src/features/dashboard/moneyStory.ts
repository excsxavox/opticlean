import type { AppState } from '../../shared/types';

export type MoneyKind = 'venta' | 'reclamo' | 'flete' | 'compra';

export type MoneyLine = {
  id: string;
  kind: MoneyKind;
  date: string;
  title: string;
  detail: string;
  /** Positivo entra; negativo sale. */
  amount: number;
};

const round = (n: number) => Math.round(n * 100) / 100;

function clientName(state: AppState, clientId: string) {
  return state.clients.find((item) => item.id === clientId)?.name ?? clientId;
}

function supplierName(state: AppState, supplierId?: string) {
  return state.suppliers?.find((item) => item.id === supplierId)?.name ?? 'Proveedor';
}

/** Kilómetros estimados de una ruta ya despachada. Empaque estima la carga con la plantilla de envío. */
function routeKm(stops: number) {
  return Math.max(15, 8 + stops * 4);
}

/**
 * El dinero que el cliente puede leer: lo vendido, lo que costó venderlo,
 * el flete de cada camión y lo comprado a proveedores. El stock inicial de
 * ejemplo no cuenta como un gasto de esta operación.
 */
export function buildMoneyStory(state: AppState) {
  const lines: MoneyLine[] = [];
  let sold = 0;
  let cogs = 0;

  for (const invoice of state.invoices ?? []) {
    if (invoice.status !== 'Emitida') continue;
    const revenue = invoice.subtotal;
    const cost = invoice.lines.reduce((n, line) => {
      const unit = line.unitCost ?? state.products.find((item) => item.id === line.productId)?.avgCost ?? 0;
      return n + line.qty * unit;
    }, 0);
    sold += revenue;
    cogs += cost;
    const margin = revenue - cost;
    lines.push({
      id: invoice.id,
      kind: 'venta',
      date: invoice.date,
      title: `${invoice.number} · ${clientName(state, invoice.clientId)}`,
      detail: `Costo ${round(cost).toFixed(2)} · margen ${round(margin).toFixed(2)}`,
      amount: round(revenue),
    });
  }

  for (const note of state.creditNotes ?? []) {
    if (note.status !== 'Emitida') continue;
    const invoice = (state.invoices ?? []).find((item) => item.id === note.invoiceId);
    const cost = note.lines.reduce((n, line) => {
      const fromInvoice = invoice?.lines.find((item) => item.productId === line.productId)?.unitCost;
      const unit = fromInvoice ?? state.products.find((item) => item.id === line.productId)?.avgCost ?? 0;
      return n + line.qty * unit;
    }, 0);
    sold -= note.subtotal;
    cogs -= cost;
    lines.push({
      id: note.id,
      kind: 'reclamo',
      date: note.date,
      title: `Reclamo ${note.number} · ${clientName(state, note.clientId)}`,
      detail: note.reason || 'Nota de crédito',
      amount: round(-note.subtotal),
    });
  }

  let freight = 0;
  const byPlate = new Map<string, { stops: number; date: string }>();
  for (const order of state.orders) {
    if (!order.vehicle || !['Entregado', 'En ruta'].includes(order.status) || order.skipped) continue;
    const current = byPlate.get(order.vehicle) ?? { stops: 0, date: '' };
    const when = (order.deliveredAt || order.date || '').slice(0, 10);
    byPlate.set(order.vehicle, {
      stops: current.stops + 1,
      date: when > current.date ? when : current.date,
    });
  }
  const routes: Array<{
    plate: string;
    label: string;
    vehicleType: string;
    stops: number;
    km: number;
    fuel: number;
    cost: number;
    date: string;
  }> = [];
  for (const [plate, route] of byPlate) {
    const vehicle = state.vehicles?.find((item) => item.plate === plate);
    const km = routeKm(route.stops);
    const allIn = round((vehicle?.costPerKm ?? 0) * km);
    const per = vehicle?.kmPerUnit && vehicle.kmPerUnit > 0 ? vehicle.kmPerUnit : 0;
    const fuel = per > 0 ? round((km / per) * (vehicle?.fuelPrice ?? 0)) : 0;
    freight += allIn;
    routes.push({
      plate,
      label: vehicle?.label || `Camión ${plate}`,
      vehicleType: 'Camión',
      stops: route.stops,
      km,
      fuel,
      cost: allIn,
      date: route.date,
    });
    lines.push({
      id: `ruta-${plate}`,
      kind: 'flete',
      date: route.date,
      title: `Camión ${plate}`,
      detail: `${route.stops} ${route.stops === 1 ? 'parada' : 'paradas'} · ${km} km · combustible ${fuel.toFixed(2)}`,
      amount: round(-allIn),
    });
  }
  routes.sort((a, b) => a.plate.localeCompare(b.plate));

  let bought = 0;
  for (const purchase of state.purchases) {
    if (purchase.status === 'Cancelada') continue;
    if (purchase.notes?.startsWith('Stock inicial')) continue;
    const cost = (purchase.lines ?? []).reduce((n, line) => {
      const units = line.receivedUnits ?? 0;
      const perUnit = line.unitsPerPack > 0 ? line.unitPrice / line.unitsPerPack : line.unitPrice;
      return n + units * perUnit;
    }, 0);
    if (cost <= 0) continue;
    bought += cost;
    const pending = purchase.status === 'Parcial' || purchase.status === 'Abierta';
    lines.push({
      id: purchase.id,
      kind: 'compra',
      date: purchase.date,
      title: `${purchase.id} · ${supplierName(state, purchase.supplierId)}`,
      detail: pending ? 'Llegó una parte. El faltante sigue pendiente.' : 'Mercadería recibida',
      amount: round(-cost),
    });
  }

  const receivable = round(
    (state.invoices ?? [])
      .filter((invoice) => invoice.status === 'Emitida')
      .reduce((n, invoice) => {
        const credited = (state.creditNotes ?? [])
          .filter((note) => note.invoiceId === invoice.id && note.status === 'Emitida')
          .reduce((sum, note) => sum + note.total, 0);
        const paid = (state.customerPayments ?? [])
          .filter((payment) => payment.invoiceId === invoice.id)
          .reduce((sum, payment) => sum + payment.amount, 0);
        return n + Math.max(0, invoice.total - credited - paid);
      }, 0),
  );
  const payable = round(
    (state.supplierBills ?? []).reduce((n, bill) => {
      const paid = (state.supplierPayments ?? [])
        .filter((payment) => payment.billId === bill.id)
        .reduce((sum, payment) => sum + payment.amount, 0);
      return n + Math.max(0, bill.total - paid);
    }, 0),
  );

  const ranked = [...lines].sort((a, b) => (b.date || '0000').localeCompare(a.date || '0000') || a.title.localeCompare(b.title));

  return {
    sold: round(sold),
    cogs: round(cogs),
    freight: round(freight),
    spent: round(cogs + freight),
    profit: round(sold - cogs - freight),
    bought: round(bought),
    receivable,
    payable,
    routes,
    routeStops: routes.reduce((n, r) => n + r.stops, 0),
    routeKmTotal: routes.reduce((n, r) => n + r.km, 0),
    lines: ranked,
  };
}
