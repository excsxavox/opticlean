import { childrenStatus, isRaw, parentsOf } from '../../shared/lib/bom';
import {
  available,
  client,
  orderValue,
  product,
  scopedLots,
  stock,
} from '../../shared/lib/inventory';
import type { AppState, Location, Order, TraceEvent } from '../../shared/types';

export type ReportPeriod = 7 | 30 | 90 | 'all';
export type ReportTab = 'capital' | 'service' | 'supply' | 'warehouse';

const DAY_MS = 86_400_000;

export function periodStart(period: ReportPeriod, now = new Date()): Date | null {
  if (period === 'all') return null;
  return new Date(now.getTime() - period * DAY_MS);
}

function parseDate(value: string): Date | null {
  if (!value) return null;
  const d = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isFinite(d.getTime()) ? d : null;
}

function inPeriod(value: string, start: Date | null): boolean {
  if (!start) return true;
  const d = parseDate(value);
  return !d || d >= start;
}

export function filterOrders(state: AppState, period: ReportPeriod): Order[] {
  const start = periodStart(period);
  return state.orders.filter((o) => inPeriod(o.date, start) || inPeriod(o.deliveredAt ?? '', start));
}

export function filterEvents(state: AppState, period: ReportPeriod): TraceEvent[] {
  const start = periodStart(period);
  return state.events.filter((e) => inPeriod(e.at, start));
}

function moneyRound(n: number) {
  return Math.round(n * 100) / 100;
}

/* ─── Capital ─────────────────────────────────────────────── */

export type CapitalLineRow = {
  category: string;
  kind: 'finished' | 'raw' | 'mixed';
  units: number;
  value: number;
  atRiskValue: number;
  excessValue: number;
};

export type CapitalRiskRow = {
  productId: string;
  name: string;
  category: string;
  kind: 'finished' | 'raw';
  available: number;
  min: number;
  gap: number;
  price: number;
  riskValue: number;
};

export type CapitalExcessRow = {
  productId: string;
  name: string;
  category: string;
  available: number;
  min: number;
  excess: number;
  excessValue: number;
};

export type ExpiryBucket = '30' | '60' | '90' | 'ok';

export type CapitalExpiryRow = {
  lotId: string;
  productId: string;
  name: string;
  batch: string;
  loc: string;
  qty: number;
  expiry: string;
  daysLeft: number;
  bucket: ExpiryBucket;
  value: number;
};

export type CapitalReport = {
  totalValue: number;
  finishedValue: number;
  rawValue: number;
  atRiskValue: number;
  excessValue: number;
  expiringValue90: number;
  insight: string;
  byLine: CapitalLineRow[];
  atRisk: CapitalRiskRow[];
  excess: CapitalExcessRow[];
  expiring: CapitalExpiryRow[];
};

export function buildCapitalReport(state: AppState, now = new Date()): CapitalReport {
  const lineMap = new Map<string, CapitalLineRow>();
  const atRisk: CapitalRiskRow[] = [];
  const excess: CapitalExcessRow[] = [];
  let totalValue = 0;
  let finishedValue = 0;
  let rawValue = 0;
  let atRiskValue = 0;
  let excessValue = 0;

  for (const p of state.products) {
    const phys = stock(state, p.id);
    const avail = available(state, p.id);
    const value = phys * p.price;
    totalValue += value;
    const kind = isRaw(p) ? 'raw' : 'finished';
    if (kind === 'raw') rawValue += value;
    else finishedValue += value;

    const bucket = lineMap.get(p.category) ?? {
      category: p.category,
      kind,
      units: 0,
      value: 0,
      atRiskValue: 0,
      excessValue: 0,
    };
    if (bucket.kind !== kind) bucket.kind = 'mixed';
    bucket.units += phys;
    bucket.value += value;

    if (avail < p.min) {
      const gap = Math.max(0, p.min - avail);
      const risk = gap * p.price;
      atRiskValue += risk;
      bucket.atRiskValue += risk;
      atRisk.push({
        productId: p.id,
        name: p.name,
        category: p.category,
        kind,
        available: avail,
        min: p.min,
        gap,
        price: p.price,
        riskValue: moneyRound(risk),
      });
    } else if (p.min > 0 && avail > p.min * 2) {
      const excessQty = avail - p.min;
      const excessVal = excessQty * p.price;
      excessValue += excessVal;
      bucket.excessValue += excessVal;
      excess.push({
        productId: p.id,
        name: p.name,
        category: p.category,
        available: avail,
        min: p.min,
        excess: excessQty,
        excessValue: moneyRound(excessVal),
      });
    }

    lineMap.set(p.category, bucket);
  }

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const expiring: CapitalExpiryRow[] = [];
  let expiringValue90 = 0;

  for (const lot of scopedLots(state)) {
    if (!lot.expiry || lot.qty <= 0) continue;
    const exp = parseDate(lot.expiry);
    if (!exp) continue;
    const daysLeft = Math.ceil((exp.getTime() - today) / DAY_MS);
    let bucket: ExpiryBucket = 'ok';
    if (daysLeft <= 30) bucket = '30';
    else if (daysLeft <= 60) bucket = '60';
    else if (daysLeft <= 90) bucket = '90';
    if (bucket === 'ok') continue;
    const p = product(state, lot.productId);
    const value = lot.qty * (p?.price ?? 0);
    expiringValue90 += value;
    expiring.push({
      lotId: lot.id,
      productId: lot.productId,
      name: p?.name ?? lot.productId,
      batch: lot.batch,
      loc: lot.loc,
      qty: lot.qty,
      expiry: lot.expiry.slice(0, 10),
      daysLeft,
      bucket,
      value: moneyRound(value),
    });
  }

  atRisk.sort((a, b) => b.riskValue - a.riskValue);
  excess.sort((a, b) => b.excessValue - a.excessValue);
  expiring.sort((a, b) => a.daysLeft - b.daysLeft);

  const topRisk = atRisk[0];
  const insight = topRisk
    ? `Hay ${moneyRound(atRiskValue).toLocaleString('es-EC', { style: 'currency', currency: 'USD' })} en riesgo de quiebre; prioriza ${topRisk.name} (faltan ${topRisk.gap} uds.).`
    : expiring.length
      ? `${expiring.length} lotes vencen en ≤90 días (${moneyRound(expiringValue90).toLocaleString('es-EC', { style: 'currency', currency: 'USD' })}).`
      : 'El capital de inventario está en nivel operativo sin quiebres relevantes.';

  return {
    totalValue: moneyRound(totalValue),
    finishedValue: moneyRound(finishedValue),
    rawValue: moneyRound(rawValue),
    atRiskValue: moneyRound(atRiskValue),
    excessValue: moneyRound(excessValue),
    expiringValue90: moneyRound(expiringValue90),
    insight,
    byLine: [...lineMap.values()].sort((a, b) => b.value - a.value).map((r) => ({
      ...r,
      value: moneyRound(r.value),
      atRiskValue: moneyRound(r.atRiskValue),
      excessValue: moneyRound(r.excessValue),
    })),
    atRisk,
    excess,
    expiring,
  };
}

/* ─── Service ─────────────────────────────────────────────── */

export type ServiceStatusRow = {
  status: string;
  count: number;
  value: number;
};

export type ServiceClientRow = {
  clientId: string;
  name: string;
  type: string;
  orders: number;
  value: number;
};

export type ServiceVelocityRow = {
  productId: string;
  name: string;
  category: string;
  qtyOrdered: number;
  available: number;
  coverDays: number | null;
  shortfall: number;
};

export type ServiceReport = {
  orderCount: number;
  pipelineValue: number;
  fillRate: number;
  linesTotal: number;
  linesCovered: number;
  insight: string;
  byStatus: ServiceStatusRow[];
  topClients: ServiceClientRow[];
  velocity: ServiceVelocityRow[];
};

export function buildServiceReport(state: AppState, period: ReportPeriod): ServiceReport {
  const orders = filterOrders(state, period);
  const byStatusMap = new Map<string, ServiceStatusRow>();
  const clientMap = new Map<string, ServiceClientRow>();
  const demandMap = new Map<string, number>();
  let pipelineValue = 0;
  let linesTotal = 0;
  let linesCovered = 0;

  for (const o of orders) {
    const value = orderValue(state, o);
    pipelineValue += value;
    const st = byStatusMap.get(o.status) ?? { status: o.status, count: 0, value: 0 };
    st.count += 1;
    st.value += value;
    byStatusMap.set(o.status, st);

    const c = client(state, o.clientId);
    const cr = clientMap.get(o.clientId) ?? {
      clientId: o.clientId,
      name: c?.name ?? o.clientId,
      type: c?.type ?? '—',
      orders: 0,
      value: 0,
    };
    cr.orders += 1;
    cr.value += value;
    clientMap.set(o.clientId, cr);

    for (const line of o.lines) {
      linesTotal += 1;
      const avail = available(state, line.productId);
      if (avail >= line.qty) linesCovered += 1;
      demandMap.set(line.productId, (demandMap.get(line.productId) ?? 0) + line.qty);
    }
  }

  const days = period === 'all' ? 90 : period;
  const velocity: ServiceVelocityRow[] = [...demandMap.entries()]
    .map(([productId, qtyOrdered]) => {
      const p = product(state, productId);
      const avail = available(state, productId);
      const daily = qtyOrdered / Math.max(days, 1);
      return {
        productId,
        name: p?.name ?? productId,
        category: p?.category ?? '—',
        qtyOrdered,
        available: avail,
        coverDays: daily > 0 ? Math.floor(avail / daily) : null,
        shortfall: Math.max(0, qtyOrdered - avail),
      };
    })
    .sort((a, b) => b.qtyOrdered - a.qtyOrdered);

  const fillRate = linesTotal ? Math.round((linesCovered / linesTotal) * 1000) / 10 : 100;
  const short = velocity.find((v) => v.shortfall > 0);
  const insight = orders.length === 0
    ? 'No hay pedidos en el periodo seleccionado.'
    : short
      ? `Fill rate ${fillRate}%. ${short.name} tiene demanda de ${short.qtyOrdered} uds. y solo ${short.available} disponibles.`
      : `Fill rate ${fillRate}% en ${orders.length} pedidos: la demanda del periodo está cubierta con stock actual.`;

  return {
    orderCount: orders.length,
    pipelineValue: moneyRound(pipelineValue),
    fillRate,
    linesTotal,
    linesCovered,
    insight,
    byStatus: [...byStatusMap.values()]
      .sort((a, b) => b.value - a.value)
      .map((r) => ({ ...r, value: moneyRound(r.value) })),
    topClients: [...clientMap.values()]
      .sort((a, b) => b.value - a.value)
      .slice(0, 8)
      .map((r) => ({ ...r, value: moneyRound(r.value) })),
    velocity: velocity.slice(0, 12),
  };
}

/* ─── Supply / BOM ────────────────────────────────────────── */

export type SupplyBlockRow = {
  childId: string;
  childName: string;
  available: number;
  min: number;
  gap: number;
  price: number;
  restockCost: number;
  parentsBlocked: number;
  parentNames: string[];
  priority: number;
};

export type SupplyParentGapRow = {
  parentId: string;
  parentName: string;
  parentAvailable: number;
  parentMin: number;
  blockingChildId: string;
  blockingChildName: string;
  childAvailable: number;
  buildable: number;
};

export type SupplyReport = {
  blockers: number;
  parentsAffected: number;
  restockCost: number;
  insight: string;
  items: SupplyBlockRow[];
  parentGaps: SupplyParentGapRow[];
};

export function buildSupplyReport(state: AppState): SupplyReport {
  const rawMap = new Map<string, SupplyBlockRow>();
  const parentGaps: SupplyParentGapRow[] = [];
  const affectedParents = new Set<string>();

  for (const parent of state.products) {
    if (isRaw(parent)) continue;
    const children = childrenStatus(state, parent);
    for (const child of children) {
      if (child.status === 'ok') continue;
      affectedParents.add(parent.id);
      const parents = parentsOf(state, child.product.id);
      const gap = Math.max(0, child.min - child.available);
      const existing = rawMap.get(child.product.id);
      if (!existing) {
        rawMap.set(child.product.id, {
          childId: child.product.id,
          childName: child.product.name,
          available: child.available,
          min: child.min,
          gap,
          price: child.product.price,
          restockCost: moneyRound(gap * child.product.price),
          parentsBlocked: parents.length,
          parentNames: parents.map((p) => p.name),
          priority: parents.length * 1000 + gap,
        });
      }
      parentGaps.push({
        parentId: parent.id,
        parentName: parent.name,
        parentAvailable: available(state, parent.id),
        parentMin: parent.min,
        blockingChildId: child.product.id,
        blockingChildName: child.product.name,
        childAvailable: child.available,
        buildable: child.buildable,
      });
    }
  }

  const items = [...rawMap.values()].sort((a, b) => b.priority - a.priority || b.restockCost - a.restockCost);
  const restockCost = moneyRound(items.reduce((n, i) => n + i.restockCost, 0));
  const top = items[0];
  const insight = top
    ? `Compra primero ${top.childName}: desbloquea ${top.parentsBlocked} producto${top.parentsBlocked === 1 ? '' : 's'} con un costo estimado de ${top.restockCost.toLocaleString('es-EC', { style: 'currency', currency: 'USD' })} al mínimo.`
    : 'Ningún insumo está bloqueando productos padre en este momento.';

  return {
    blockers: items.length,
    parentsAffected: affectedParents.size,
    restockCost,
    insight,
    items,
    parentGaps: parentGaps.sort((a, b) => a.buildable - b.buildable).slice(0, 12),
  };
}

/* ─── Warehouse ───────────────────────────────────────────── */

export type WarehouseRackRow = {
  rack: string;
  category: string;
  positions: number;
  occupied: number;
  occupancyPct: number;
  units: number;
  value: number;
};

export type WarehouseIdleRow = {
  loc: string;
  rack: string;
  units: number;
  value: number;
  lastMoveAt: string | null;
  daysIdle: number | null;
};

export type WarehouseValueRow = {
  loc: string;
  rack: string;
  units: number;
  value: number;
  products: number;
};

export type WarehouseReport = {
  totalPositions: number;
  occupied: number;
  free: number;
  occupancyPct: number;
  totalValue: number;
  insight: string;
  byRack: WarehouseRackRow[];
  idle: WarehouseIdleRow[];
  topValue: WarehouseValueRow[];
};

export function buildWarehouseReport(
  state: AppState,
  locations: Location[],
  period: ReportPeriod,
  now = new Date(),
): WarehouseReport {
  const events = filterEvents(state, period === 'all' ? 90 : period);
  const lastMove = new Map<string, string>();
  for (const e of state.events) {
    for (const loc of [e.from, e.to]) {
      if (!loc || loc === '—' || loc === '-') continue;
      const prev = lastMove.get(loc);
      if (!prev || e.at > prev) lastMove.set(loc, e.at);
    }
  }
  // Prefer recent period events for idle proxy, but fall back to all-time last move
  for (const e of events) {
    for (const loc of [e.from, e.to]) {
      if (!loc || loc === '—' || loc === '-') continue;
      const prev = lastMove.get(loc);
      if (!prev || e.at > prev) lastMove.set(loc, e.at);
    }
  }

  const lots = scopedLots(state);
  const qtyByLoc = new Map<string, number>();
  const valueByLoc = new Map<string, number>();
  const productsByLoc = new Map<string, Set<string>>();
  for (const lot of lots) {
    if (lot.qty <= 0) continue;
    qtyByLoc.set(lot.loc, (qtyByLoc.get(lot.loc) ?? 0) + lot.qty);
    const p = product(state, lot.productId);
    valueByLoc.set(lot.loc, (valueByLoc.get(lot.loc) ?? 0) + lot.qty * (p?.price ?? 0));
    const set = productsByLoc.get(lot.loc) ?? new Set();
    set.add(lot.productId);
    productsByLoc.set(lot.loc, set);
  }

  const rackMap = new Map<string, WarehouseRackRow>();
  let occupied = 0;
  let totalValue = 0;

  for (const loc of locations) {
    const units = qtyByLoc.get(loc.id) ?? 0;
    const value = valueByLoc.get(loc.id) ?? 0;
    totalValue += value;
    if (units > 0) occupied += 1;
    const key = loc.rack;
    const row = rackMap.get(key) ?? {
      rack: loc.rack,
      category: loc.category,
      positions: 0,
      occupied: 0,
      occupancyPct: 0,
      units: 0,
      value: 0,
    };
    row.positions += 1;
    if (units > 0) row.occupied += 1;
    row.units += units;
    row.value += value;
    rackMap.set(key, row);
  }

  const byRack = [...rackMap.values()]
    .map((r) => ({
      ...r,
      occupancyPct: Math.round((r.occupied / Math.max(r.positions, 1)) * 100),
      value: moneyRound(r.value),
    }))
    .sort((a, b) => b.value - a.value);

  const today = now.getTime();
  const idle: WarehouseIdleRow[] = locations
    .filter((l) => (qtyByLoc.get(l.id) ?? 0) > 0)
    .map((l) => {
      const last = lastMove.get(l.id) ?? null;
      const lastDate = last ? parseDate(last) : null;
      const daysIdle = lastDate ? Math.floor((today - lastDate.getTime()) / DAY_MS) : null;
      return {
        loc: l.id,
        rack: l.rack,
        units: qtyByLoc.get(l.id) ?? 0,
        value: moneyRound(valueByLoc.get(l.id) ?? 0),
        lastMoveAt: last,
        daysIdle,
      };
    })
    .filter((r) => r.daysIdle === null || r.daysIdle >= 14)
    .sort((a, b) => (b.daysIdle ?? 9999) - (a.daysIdle ?? 9999) || b.value - a.value)
    .slice(0, 12);

  const topValue: WarehouseValueRow[] = locations
    .map((l) => ({
      loc: l.id,
      rack: l.rack,
      units: qtyByLoc.get(l.id) ?? 0,
      value: moneyRound(valueByLoc.get(l.id) ?? 0),
      products: productsByLoc.get(l.id)?.size ?? 0,
    }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  const totalPositions = locations.length;
  const free = Math.max(0, totalPositions - occupied);
  const occupancyPct = Math.round((occupied / Math.max(totalPositions, 1)) * 100);
  const densest = byRack[0];
  const insight = densest
    ? `Ocupación ${occupancyPct}% (${free} posiciones libres). El rack ${densest.rack} concentra ${densest.value.toLocaleString('es-EC', { style: 'currency', currency: 'USD' })}.`
    : `Ocupación ${occupancyPct}% con ${free} posiciones libres.`;

  return {
    totalPositions,
    occupied,
    free,
    occupancyPct,
    totalValue: moneyRound(totalValue),
    insight,
    byRack,
    idle,
    topValue,
  };
}

/* ─── Snapshot KPIs ───────────────────────────────────────── */

export type ReportsSnapshot = {
  capital: CapitalReport;
  service: ServiceReport;
  supply: SupplyReport;
  warehouse: WarehouseReport;
};

export function buildReportsSnapshot(
  state: AppState,
  locations: Location[],
  period: ReportPeriod,
): ReportsSnapshot {
  return {
    capital: buildCapitalReport(state),
    service: buildServiceReport(state, period),
    supply: buildSupplyReport(state),
    warehouse: buildWarehouseReport(state, locations, period),
  };
}
